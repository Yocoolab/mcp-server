import http from 'node:http';
import { execFile } from 'node:child_process';
import { v4 as uuidv4 } from 'uuid';
import type { SelectionStore } from './selection-store.js';

export interface ConnectedAgent {
  id: string;
  name: string;
  type: string; // 'claude-code' | 'roo' | 'cline' | 'cursor' | 'windsurf' | 'custom'
  cwd?: string;
  connectedAt: number;
  lastHeartbeat: number;
}

const agentRegistry = new Map<string, ConnectedAgent>();

// Clean up stale agents (no heartbeat in 30s)
setInterval(() => {
  const now = Date.now();
  for (const [id, agent] of agentRegistry) {
    if (now - agent.lastHeartbeat > 30_000) {
      agentRegistry.delete(id);
    }
  }
}, 10_000);

export type ThreadUpdateEmitter = (threadId: string, eventType: string, data: Record<string, unknown>) => void;

export interface CompanionMessage {
  id: string;
  content: string;
  timestamp: number;
  pageContext?: Record<string, unknown>;
  screenshot?: string;
  elementContext?: Record<string, unknown>;
  voice?: boolean;
  // Multi-context: arrays when user gathers multiple items before sending
  screenshots?: string[];
  elements?: Array<Record<string, unknown>>;
}

export interface BridgeResult {
  server: http.Server;
  emitThreadUpdate: ThreadUpdateEmitter;
  getCompanionMessages: () => CompanionMessage[];
  postCompanionReply: (content: string) => void;
  onCompanionMessage: (callback: (msg: CompanionMessage) => void) => void;
}

/**
 * The osascript argv for a macOS notification. The script is fixed; the text,
 * title and subtitle reach its run handler as arguments (after `--`, so a text
 * that starts with "-" is not read as an option). Nothing a page, a selection
 * or a companion message says is ever AppleScript source, so no escaping can
 * be got wrong — the old builder escaped quotes but not backslashes, and
 * `\" & (do shell script "…") & \"` ran.
 */
export function notificationArgs(text: string, title: string, subtitle: string): string[] {
  return [
    '-e', 'on run argv',
    '-e', 'display notification (item 1 of argv) with title (item 2 of argv) subtitle (item 3 of argv)',
    '-e', 'end run',
    '--', text, title, subtitle,
  ];
}

function notify(text: string, title: string, subtitle: string, what: string): void {
  execFile('osascript', notificationArgs(text, title, subtitle), (err) => {
    if (err) process.stderr.write(`[yocoolab] ${what} error: ${err.message}\n`);
  });
}

function notifyCompanionMessage(content: string): void {
  const preview = content.length > 80 ? content.slice(0, 77) + '...' : content;
  notify(preview, 'Yocoolab Companion', 'New message', 'Companion notification');
}

function notifySelection(tag: string, text: string, pageUrl: string): void {
  const label = text ? `<${tag}> "${text.slice(0, 60)}"` : `<${tag}>`;
  let urlPath = '/';
  try {
    urlPath = new URL(pageUrl).pathname;
  } catch { /* ignore invalid URLs */ }
  notify(`${label} on ${urlPath}`, 'Yocoolab Bridge', 'Element captured', 'Notification');
}

export function startHttpBridge(port: number, store: SelectionStore): BridgeResult {
  // SSE client connections
  const sseClients = new Set<http.ServerResponse>();

  // Companion message queue (in-memory, cleared when read)
  const companionMessages: CompanionMessage[] = [];
  let companionMsgCounter = 0;

  // Companion reply queue (for polling fallback when SSE isn't connected)
  const companionReplies: string[] = [];

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

  function onCompanionMessage(callback: (msg: CompanionMessage) => void): void {
    companionCallback = callback;
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', `http://localhost:${port}`);

    // CORS is decided per route (see routeAudience). A preflight is judged by
    // the method it asks for.
    const isPreflight = req.method === 'OPTIONS';
    const method = isPreflight
      ? String(req.headers['access-control-request-method'] || '').toUpperCase()
      : (req.method || '');
    const audience = routeAudience(method, url.pathname);
    const caller = browserCaller(req.headers);

    // Nothing in a browser — a web page or any installed extension — reaches
    // the local routes, and a web page reaches only the page-world ones.
    // Withholding CORS headers is not enough on its own: a text/plain POST
    // goes out without a preflight, so a caller could still fake a selection,
    // queue a companion message for the agent or register a phantom agent.
    if (caller !== null && (audience === 'local' || (audience === 'extension' && caller === 'web'))) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Forbidden origin' }));
      return;
    }

    if (audience === 'page') {
      res.setHeader('Access-Control-Allow-Origin', '*');
    } else if (audience === 'extension') {
      res.setHeader('Vary', 'Origin');
      // An extension holding a host permission sends no Origin on its GETs
      // and needs no CORS grant.
      if (caller === 'extension' && req.headers.origin) res.setHeader('Access-Control-Allow-Origin', String(req.headers.origin));
    }

    if (isPreflight) {
      if (res.hasHeader('Access-Control-Allow-Origin')) {
        res.setHeader('Access-Control-Allow-Methods', `${method}, OPTIONS`);
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        // Private Network Access preflight (a public page reaching 127.0.0.1):
        // granted only on the routes the page world is meant to reach.
        if (audience === 'page' && req.headers['access-control-request-private-network'] === 'true') {
          res.setHeader('Access-Control-Allow-Private-Network', 'true');
        }
      }
      res.writeHead(204);
      res.end();
      return;
    }

    // ─── Bridge routes ────────────────────────────────────────────

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

    // POST /event — element selection from the Chrome extension (feeds /selections/*)
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
          // Credentials never enter the store: it is served to every local
          // caller and get_latest_selection prints it whole into the agent's
          // transcript. Older extension builds put the person's Yocoolab JWT
          // here as `auth: { token, apiUrl }`; nothing in this server reads it.
          delete payload.auth;

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
            agents: Array.from(agentRegistry.values()),
          },
          uptime: process.uptime(),
        })
      );
      return;
    }

    // Agent registry: list connected agents
    if (req.method === 'GET' && url.pathname === '/agents') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ agents: Array.from(agentRegistry.values()) }));
      return;
    }

    // Agent registry: register/heartbeat
    if (req.method === 'POST' && url.pathname === '/agents/register') {
      let body = '';
      req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          const id = data.id || uuidv4();
          const agent: ConnectedAgent = {
            id,
            name: data.name || 'Unknown Agent',
            type: data.type || 'custom',
            cwd: data.cwd,
            connectedAt: agentRegistry.get(id)?.connectedAt || Date.now(),
            lastHeartbeat: Date.now(),
          };
          agentRegistry.set(id, agent);
          process.stderr.write(`[yocoolab-bridge] Agent registered: ${agent.name} (${agent.type})\n`);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, agent }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON' }));
        }
      });
      return;
    }

    // Agent registry: unregister
    if (req.method === 'DELETE' && url.pathname.startsWith('/agents/')) {
      const agentId = url.pathname.split('/agents/')[1];
      agentRegistry.delete(agentId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
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
            // Multi-context arrays (when user gathers multiple items before sending)
            screenshots: Array.isArray(data.screenshots) ? data.screenshots : undefined,
            elements: Array.isArray(data.elements) ? data.elements : undefined,
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

    // Peek without draining - used by hooks so withCompanion() can still drain
    if (req.method === 'GET' && url.pathname === '/companion/peek') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ messages: [...companionMessages] }));
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

    res.writeHead(404);
    res.end('Not Found');
  });

  // Retry logic: if port is briefly held by a dying process, retry up to 5 times
  let retryCount = 0;
  const MAX_RETRIES = 5;
  const RETRY_DELAY_MS = 1500;

  function tryListen(): void {
    server.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE' && retryCount < MAX_RETRIES) {
        retryCount++;
        process.stderr.write(
          `[yocoolab] Port ${port} in use, retrying (${retryCount}/${MAX_RETRIES}) in ${RETRY_DELAY_MS}ms...\n`
        );
        setTimeout(tryListen, RETRY_DELAY_MS);
        return;
      }
      if (err.code === 'EADDRINUSE') {
        process.stderr.write(
          `[yocoolab] Port ${port} still in use after ${MAX_RETRIES} retries. Bridge not started.\n`
        );
        return;
      }
      throw err;
    });

    server.listen(port, '127.0.0.1', () => {
      process.stderr.write(`[yocoolab] HTTP bridge listening on http://127.0.0.1:${port}\n`);
    });
  }

  tryListen();

  return { server, emitThreadUpdate, getCompanionMessages, postCompanionReply, onCompanionMessage };
}

/**
 * Who may call a route from a browser. The bridge listens on 127.0.0.1 only,
 * but every web page the person opens can still send it requests.
 *
 * - 'page': the extension's page-world script. comments-ui.js is injected into
 *   the host page's MAIN world, so its fetch carries the page's origin; it
 *   probes GET /agents for the agent picker and the Agent gate. GET /health
 *   carries the same agent list plus two counters. → `Access-Control-Allow-Origin: *`.
 * - 'extension': the extension's background worker (POST /event for Send to
 *   Agent, the /thread-updates EventSource). Without a granted host permission
 *   for 127.0.0.1 — the manifest only has optional ones — its requests are
 *   CORS-checked and carry `Origin: chrome-extension://<id>`. → that origin is
 *   echoed back; a web origin gets nothing and is refused.
 * - 'local' (everything else: /selections*, /companion*, /agents/register,
 *   DELETE /agents/:id): agents, hooks and scripts on this machine (Node,
 *   curl) send no Origin and need no CORS headers. → none, and every browser
 *   caller — web page or extension — is refused outright. The extension never
 *   calls these; any other installed extension could.
 */
type RouteAudience = 'page' | 'extension' | 'local';

function routeAudience(method: string, pathname: string): RouteAudience {
  if (method === 'GET' && (pathname === '/health' || pathname === '/agents')) return 'page';
  if (method === 'POST' && pathname === '/event') return 'extension';
  if (method === 'GET' && pathname === '/thread-updates') return 'extension';
  return 'local';
}

const EXTENSION_ORIGIN = /^(chrome-extension|moz-extension|safari-web-extension):\/\/[A-Za-z0-9._-]+$/;

/**
 * 'extension' or 'web' for a browser caller, null for a local process.
 *
 * Local processes send no Fetch Metadata: curl and Node's http send no
 * Sec-Fetch-* at all, Node's fetch only Sec-Fetch-Mode. A browser marks every
 * request to 127.0.0.1 with Sec-Fetch-Site, even when it sends no Origin:
 * - a no-cors GET from a page (an <img>, a no-cors fetch) → cross-site/same-site;
 * - a same-origin GET → same-origin;
 * - an extension holding a host permission for 127.0.0.1 sends its GETs
 *   (EventSource included) with no Origin and `none` — checked in Chromium —
 *   and so does an address typed into the browser. Counted as 'extension':
 *   it may reach the extension routes, never the local ones.
 */
function browserCaller(headers: http.IncomingHttpHeaders): 'extension' | 'web' | null {
  const origin = headers.origin;
  if (origin) return EXTENSION_ORIGIN.test(origin) ? 'extension' : 'web';
  const site = headers['sec-fetch-site'];
  if (!site) return null;
  return site === 'none' ? 'extension' : 'web';
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
