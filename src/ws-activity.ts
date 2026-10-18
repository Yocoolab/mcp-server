import { WebSocketServer, WebSocket } from 'ws';
import type http from 'node:http';
import type { Duplex } from 'node:stream';
import type { ActivityEvent, SessionSummary, WSMessage } from './activity-types.js';
import type { ActivityEventStore } from './event-store.js';
import type { SessionManager } from './session-manager.js';
import { WS_HEARTBEAT_INTERVAL, SNAPSHOT_SIZE } from './activity-constants.js';
import { browserCaller, isLoopbackHost } from './http-bridge.js';

export interface ActivityWsResult {
  broadcast: (event: ActivityEvent) => void;
  broadcastSessionUpdate: (session: SessionSummary) => void;
  clientCount: () => number;
}

export function attachActivityWs(
  server: http.Server,
  eventStore: ActivityEventStore,
  sessionManager: SessionManager,
): ActivityWsResult {
  const wss = new WebSocketServer({ noServer: true });
  const clients = new Set<WebSocket>();

  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url || '/', 'http://localhost');
    if (url.pathname !== '/ws/activity') {
      socket.destroy();
      return;
    }
    // The stream carries every prompt, tool input and tool output the hooks
    // report, and a WebSocket is not subject to CORS: the handshake itself
    // must refuse what the HTTP routes refuse. A rebinding page still names
    // itself in Host; a web page always sends its Origin on a handshake.
    // Local clients (no Origin) and the extension's background worker
    // (chrome-extension://…, builds before 1.9.202) may connect.
    if (!isLoopbackHost(request.headers.host)) {
      refuseUpgrade(socket, 421, 'Misdirected Request');
      return;
    }
    if (browserCaller(request.headers) === 'web') {
      refuseUpgrade(socket, 403, 'Forbidden');
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  });

  wss.on('connection', (ws) => {
    clients.add(ws);
    process.stderr.write(`[yocoolab] Activity WS client connected (${clients.size} total)\n`);

    // Send snapshot on connect
    const snapshot: WSMessage = {
      type: 'snapshot',
      data: {
        events: eventStore.recent(SNAPSHOT_SIZE),
        sessions: sessionManager.getAllSessions(),
      },
    };
    ws.send(JSON.stringify(snapshot));

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong' }));
        }
      } catch {
        // ignore malformed messages
      }
    });

    ws.on('close', () => {
      clients.delete(ws);
      process.stderr.write(`[yocoolab] Activity WS client disconnected (${clients.size} total)\n`);
    });

    ws.on('error', (err) => {
      process.stderr.write(`[yocoolab] Activity WS client error: ${err.message}\n`);
      clients.delete(ws);
    });
  });

  // Heartbeat
  const heartbeat = setInterval(() => {
    const ping: WSMessage = { type: 'ping' };
    const msg = JSON.stringify(ping);
    for (const ws of clients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(msg);
      }
    }
  }, WS_HEARTBEAT_INTERVAL);

  wss.on('close', () => {
    clearInterval(heartbeat);
  });

  function broadcast(event: ActivityEvent): void {
    const msg: WSMessage = { type: 'event', data: event };
    const payload = JSON.stringify(msg);
    for (const ws of clients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(payload);
      }
    }
  }

  function broadcastSessionUpdate(session: SessionSummary): void {
    const msg: WSMessage = { type: 'session_update', data: session };
    const payload = JSON.stringify(msg);
    for (const ws of clients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(payload);
      }
    }
  }

  function clientCount(): number {
    return clients.size;
  }

  return { broadcast, broadcastSessionUpdate, clientCount };
}

/** Answer a WebSocket handshake with a plain HTTP error and hang up. */
function refuseUpgrade(socket: Duplex, status: number, reason: string): void {
  // end(), not write() + destroy(): the status line must reach the client.
  socket.once('finish', () => socket.destroy());
  socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}
