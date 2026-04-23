import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { v4 as uuidv4 } from 'uuid';
import type { SelectionStore } from './selection-store.js';
import type { ActivityEventStore } from './event-store.js';
import type { SessionManager } from './session-manager.js';
import type { ActivityEvent, RawHookPayload } from './activity-types.js';
import { MAX_TOOL_RESPONSE_SIZE } from './activity-constants.js';
const DASHBOARD_DIR = path.resolve(__dirname, '../dashboard');

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

export type ThreadUpdateEmitter = (threadId: string, eventType: string, data: Record<string, unknown>) => void;

export interface CompanionMessage {
  id: string;
  content: string;
  timestamp: number;
  pageContext?: Record<string, unknown>;
  screenshot?: string;
  elementContext?: Record<string, unknown>;
  voice?: boolean;
}

export interface BridgeResult {
  server: http.Server;
  emitThreadUpdate: ThreadUpdateEmitter;
  getCompanionMessages: () => CompanionMessage[];
  postCompanionReply: (content: string) => void;
  onActivityEvent: (callback: (event: ActivityEvent) => void) => void;
  onCompanionMessage: (callback: (msg: CompanionMessage) => void) => void;
}

function notifyCompanionMessage(content: string): void {
  const preview = content.length > 80 ? content.slice(0, 77) + '...' : content;
  execFile('osascript', [
    '-e',
    `display notification "${preview.replace(/"/g, '\\"')}" with title "Yocoolab Companion" subtitle "New message"`,
  ], (err) => {
    if (err) process.stderr.write(`[yocoolab] Companion notification error: ${err.message}\n`);
  });
}

function notifySelection(tag: string, text: string, pageUrl: string): void {
  const label = text ? `<${tag}> "${text.slice(0, 60)}"` : `<${tag}>`;
  let urlPath = '/';
  try {
    urlPath = new URL(pageUrl).pathname;
  } catch { /* ignore invalid URLs */ }
  execFile('osascript', [
    '-e',
    `display notification "${label} on ${urlPath}" with title "Yocoolab Bridge" subtitle "Element captured"`,
  ], (err) => {
    if (err) process.stderr.write(`[yocoolab] Notification error: ${err.message}\n`);
  });
}

function rawToEvent(raw: RawHookPayload): ActivityEvent {
  let toolResponse = raw.tool_response;
  if (typeof toolResponse === 'string' && toolResponse.length > MAX_TOOL_RESPONSE_SIZE) {
    toolResponse = toolResponse.slice(0, MAX_TOOL_RESPONSE_SIZE) + '\n... [truncated]';
  }

  return {
    id: uuidv4(),
    timestamp: Date.now(),
    received_at: Date.now(),
    session_id: raw.session_id || 'unknown',
    hook_event_name: raw.hook_event_name as ActivityEvent['hook_event_name'],
    cwd: raw.cwd || '',
    transcript_path: raw.transcript_path || '',
    tool_name: raw.tool_name,
    tool_input: raw.tool_input as ActivityEvent['tool_input'],
    tool_response: toolResponse,
    tool_use_id: raw.tool_use_id,
    error: raw.error,
    source: raw.source,
    prompt: raw.prompt,
    agent_id: raw.agent_id,
    agent_type: raw.agent_type,
    stop_hook_active: raw.stop_hook_active,
    message: raw.message,
    notification_type: raw.notification_type,
  };
}

export function startHttpBridge(
  port: number,
  store: SelectionStore,
  activityEventStore: ActivityEventStore,
  sessionManager: SessionManager,
): BridgeResult {
  // SSE client connections
  const sseClients = new Set<http.ServerResponse>();

  // Companion message queue (in-memory, cleared when read)
  const companionMessages: CompanionMessage[] = [];
  let companionMsgCounter = 0;

  // Companion reply queue (for polling fallback when SSE isn't connected)
  const companionReplies: string[] = [];

  // Activity event callback (set by caller to trigger WS broadcast)
  let activityCallback: ((event: ActivityEvent) => void) | null = null;

  // Companion message callback (set by caller to trigger MCP notification)
  let companionCallback: ((msg: CompanionMessage) => void) | null = null;

  // Heartbeat every 15s to keep SSE connections alive
  setInterval(() => {
    for (const client of sseClients) {
      try {
        client.write(':heartbeat\n\n');
      } catch {
        sseClients.delete(client);
      }
    }
  }, 15000);

  function emitThreadUpdate(threadId: string, eventType: string, data: Record<string, unknown>): void {
    const payload = JSON.stringify({ threadId, type: eventType, ...data });
    process.stderr.write(`[yocoolab] SSE emit: ${eventType} for thread ${threadId.slice(0, 8)} → ${sseClients.size} client(s)\n`);
    for (const client of sseClients) {
      try {
        client.write(`event: thread_update\ndata: ${payload}\n\n`);
      } catch {
        sseClients.delete(client);
      }
    }
  }

  function emitCompanionReply(content: string): void {
    const payload = JSON.stringify({ content });
    process.stderr.write(`[yocoolab] SSE companion_reply → ${sseClients.size} client(s)\n`);
    for (const client of sseClients) {
      try {
        client.write(`event: companion_reply\ndata: ${payload}\n\n`);
      } catch {
        sseClients.delete(client);
      }
    }
  }

  function getCompanionMessages(): CompanionMessage[] {
    const msgs = [...companionMessages];
    companionMessages.length = 0;
    return msgs;
  }

  function postCompanionReply(content: string): void {
    companionReplies.push(content);
    emitCompanionReply(content);
  }

  function onActivityEvent(callback: (event: ActivityEvent) => void): void {
    activityCallback = callback;
  }

  function onCompanionMessage(callback: (msg: CompanionMessage) => void): void {
    companionCallback = callback;
  }

  const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url || '/', `http://localhost:${port}`);

    // ─── Activity Monitor routes ──────────────────────────────────

    // POST /monitor/events — hook event ingestion (from send-event.sh)
    if (req.method === 'POST' && url.pathname === '/monitor/events') {
      let body = '';
      req.on('data', (chunk: string) => { body += chunk; });
      req.on('end', () => {
        try {
          const raw: RawHookPayload = JSON.parse(body);
          const event = rawToEvent(raw);

          activityEventStore.push(event);
          sessionManager.processEvent(event);

          // Trigger WS broadcast via callback
          if (activityCallback) activityCallback(event);

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, id: event.id }));
        } catch (err) {
          process.stderr.write(`[yocoolab] Failed to process hook event: ${err}\n`);
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Invalid payload' }));
        }
      });
      return;
    }

    // GET /monitor/api/events/recent
    if (req.method === 'GET' && url.pathname === '/monitor/api/events/recent') {
      const limit = parseInt(url.searchParams.get('limit') || '200', 10);
      const events = activityEventStore.recent(limit);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(events));
      return;
    }

    // GET /monitor/api/sessions
    if (req.method === 'GET' && url.pathname === '/monitor/api/sessions') {
      const sessions = sessionManager.getAllSessions();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(sessions));
      return;
    }

    // ─── Bridge routes (existing) ─────────────────────────────────

    // SSE endpoint for thread updates
    if (req.method === 'GET' && url.pathname === '/thread-updates') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });
      res.write(':connected\n\n');

      sseClients.add(res);
      process.stderr.write(`[yocoolab] SSE client connected (${sseClients.size} total)\n`);

      req.on('close', () => {
        sseClients.delete(res);
        process.stderr.write(`[yocoolab] SSE client disconnected (${sseClients.size} remaining)\n`);
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/event') {
      let body = '';
      req.on('data', (chunk: string) => {
        body += chunk;
      });
      req.on('end', () => {
        try {
          const payload = JSON.parse(body);

          if (!isValidPayload(payload)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid payload' }));
            return;
          }

          if (!payload.correlationId) {
            payload.correlationId = uuidv4();
          }
          if (!payload.timestamp) {
            payload.timestamp = Date.now();
          }

          store.push(payload);

          process.stderr.write(
            `[yocoolab] Received: <${payload.element.tag}> "${payload.element.text?.slice(0, 40)}" (${payload.element.selector})\n`
          );

          notifySelection(
            payload.element.tag,
            payload.element.text || '',
            payload.page?.url || ''
          );

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({ ok: true, correlationId: payload.correlationId })
          );
        } catch (e) {
          process.stderr.write(`[yocoolab] Parse error: ${e}\n`);
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON' }));
        }
      });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          status: 'ok',
          bridge: {
            selections: store.count(),
            sseClients: sseClients.size,
          },
          monitor: {
            events: activityEventStore.count(),
            sessions: sessionManager.getAllSessions().length,
          },
          uptime: process.uptime(),
        })
      );
      return;
    }

    if (req.method === 'GET' && url.pathname === '/selections/latest') {
      const latest = store.latest();
      if (!latest) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ selection: null }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ selection: latest }));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/selections') {
      const limit = parseInt(url.searchParams.get('limit') || '10', 10);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ selections: store.history(limit) }));
      return;
    }

    // ─── Companion chat endpoints ─────────────────────────────────

    if (req.method === 'POST' && url.pathname === '/companion/message') {
      let body = '';
      req.on('data', (chunk: string) => { body += chunk; });
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          if (!data.content || typeof data.content !== 'string') {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing content field' }));
            return;
          }

          const msg: CompanionMessage = {
            id: String(++companionMsgCounter),
            content: data.content,
            timestamp: Date.now(),
            pageContext: data.pageContext,
            screenshot: data.screenshot,
            elementContext: data.elementContext,
            voice: data.voice,
          };

          companionMessages.push(msg);
          process.stderr.write(`[yocoolab] Companion message #${msg.id}: "${msg.content.slice(0, 60)}"\n`);

          notifyCompanionMessage(msg.content);

          // Trigger MCP notification callback
          if (companionCallback) companionCallback(msg);

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, id: msg.id }));
        } catch (e) {
          process.stderr.write(`[yocoolab] Companion message parse error: ${e}\n`);
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON' }));
        }
      });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/companion/messages') {
      const msgs = getCompanionMessages();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ messages: msgs }));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/companion/poll-reply') {
      const replies = [...companionReplies];
      companionReplies.length = 0;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ replies }));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/companion/reply') {
      let body = '';
      req.on('data', (chunk: string) => { body += chunk; });
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          if (!data.content || typeof data.content !== 'string') {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing content field' }));
            return;
          }

          postCompanionReply(data.content);

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        } catch (e) {
          process.stderr.write(`[yocoolab] Companion reply parse error: ${e}\n`);
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON' }));
        }
      });
      return;
    }

    // ─── Dashboard static files ───────────────────────────────────

    if (req.method === 'GET' && url.pathname.startsWith('/dashboard')) {
      serveDashboard(url.pathname.replace('/dashboard', '') || '/', res);
      return;
    }

    res.writeHead(404);
    res.end('Not Found');
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      process.stderr.write(
        `[yocoolab] Port ${port} is already in use. ` +
          `Is another instance running? Set YOCOOLAB_BRIDGE_PORT to a different port.\n`
      );
      return;
    }
    throw err;
  });

  server.listen(port, '127.0.0.1', () => {
    process.stderr.write(`[yocoolab] HTTP bridge + monitor listening on http://127.0.0.1:${port}\n`);
    process.stderr.write(`[yocoolab] Dashboard: http://localhost:${port}/dashboard/\n`);
    process.stderr.write(`[yocoolab] Activity WS: ws://127.0.0.1:${port}/ws/activity\n`);
  });

  return { server, emitThreadUpdate, getCompanionMessages, postCompanionReply, onActivityEvent, onCompanionMessage };
}

function isValidPayload(data: unknown): boolean {
  if (typeof data !== 'object' || data === null) return false;
  const d = data as Record<string, unknown>;
  return (
    d.type === 'ELEMENT_SELECTED' &&
    typeof d.element === 'object' &&
    typeof d.page === 'object'
  );
}

function serveDashboard(pathname: string, res: http.ServerResponse): void {
  let filePath = path.join(DASHBOARD_DIR, pathname === '/' ? 'index.html' : pathname);

  // Security: prevent directory traversal
  if (!filePath.startsWith(DASHBOARD_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  // SPA fallback
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(DASHBOARD_DIR, 'index.html');
  }

  if (!fs.existsSync(filePath)) {
    res.writeHead(404, { 'Content-Type': 'text/html' });
    res.end('<h1>Dashboard not built</h1><p>Dashboard static files not found.</p>');
    return;
  }

  const ext = path.extname(filePath);
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  if (pathname.includes('/assets/')) {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  } else {
    res.setHeader('Cache-Control', 'no-cache');
  }

  const stream = fs.createReadStream(filePath);
  res.writeHead(200, { 'Content-Type': contentType });
  stream.pipe(res);
}
