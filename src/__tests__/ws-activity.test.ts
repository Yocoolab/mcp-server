import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import http from 'node:http';
import { SelectionStore } from '../selection-store.js';
import { SessionManager } from '../session-manager.js';
import { startHttpBridge } from '../http-bridge.js';
import { attachActivityWs } from '../ws-activity.js';
import type { ActivityEventStore } from '../event-store.js';
import type { ActivityEvent } from '../activity-types.js';

vi.mock('node:child_process', () => ({
  execFile: vi.fn((_cmd: string, _args: string[], cb: (err: Error | null) => void) => cb(null)),
}));

// The activity WebSocket streams every Claude Code event the hooks report —
// prompts, tool inputs, tool outputs — and sends the last 200 on connect.
// WebSockets are not subject to CORS: without a check on the handshake, any
// site the person has open could read them all.

const EXT_ORIGIN = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';
const PAGE_ORIGIN = 'https://tfaspa.example';

function memoryEventStore(seed: ActivityEvent[]): ActivityEventStore {
  const events = [...seed];
  return {
    push: (e: ActivityEvent) => { events.push(e); },
    recent: (limit = 200) => events.slice(Math.max(0, events.length - limit)),
    count: () => events.length,
    loadFromDisk: () => {},
    close: () => {},
  } as unknown as ActivityEventStore;
}

const SECRET_EVENT = {
  id: 'e1', timestamp: 1, received_at: 1, session_id: 'secret-session', hook_event_name: 'UserPromptSubmit',
  cwd: '/Users/someone/repo', transcript_path: '', prompt: 'my private prompt',
} as unknown as ActivityEvent;

/** Try the handshake; report whether it upgraded and what the first frame said. */
function handshake(port: number, headers: Record<string, string>): Promise<{ outcome: string; firstFrame: string }> {
  return new Promise((resolve) => {
    const req = http.request({
      hostname: '127.0.0.1', port, method: 'GET', path: '/ws/activity',
      headers: {
        Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==', ...headers,
      },
    });
    req.on('upgrade', (_res, socket, head) => {
      let data = head.toString('latin1');
      const done = () => { socket.destroy(); resolve({ outcome: 'upgraded', firstFrame: data }); };
      if (data.includes('secret-session')) return done();
      socket.on('data', (chunk: Buffer) => { data += chunk.toString('latin1'); if (data.includes('}')) done(); });
      setTimeout(done, 500);
    });
    req.on('response', (res) => { resolve({ outcome: `response:${res.statusCode}`, firstFrame: '' }); res.resume(); });
    req.on('error', () => resolve({ outcome: 'closed', firstFrame: '' }));
    req.end();
  });
}

describe('activity WebSocket handshake (2.x)', () => {
  let server: http.Server;
  let port: number;

  beforeEach(async () => {
    const bridge = startHttpBridge(0, new SelectionStore(), memoryEventStore([SECRET_EVENT]), new SessionManager());
    server = bridge.server;
    attachActivityWs(server, memoryEventStore([SECRET_EVENT]), new SessionManager());
    await new Promise<void>((resolve) => server.once('listening', () => {
      port = (server.address() as { port: number }).port;
      resolve();
    }));
  });

  afterEach(async () => {
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('a local client (no Origin) connects and gets the snapshot', async () => {
    const { outcome, firstFrame } = await handshake(port, {});
    expect(outcome).toBe('upgraded');
    expect(firstFrame).toContain('secret-session');
  });

  it('the extension\'s background worker (extension Origin) connects', async () => {
    const { outcome, firstFrame } = await handshake(port, { Origin: EXT_ORIGIN });
    expect(outcome).toBe('upgraded');
    expect(firstFrame).toContain('secret-session');
  });

  it.each([
    PAGE_ORIGIN,
    'http://localhost:3000',
    'https://chrome-extension.evil.example',
    'null',
  ])('a web page (Origin %s) is refused before the handshake and gets no events', async (origin) => {
    const { outcome, firstFrame } = await handshake(port, { Origin: origin });
    expect(outcome).toBe('response:403');
    expect(firstFrame).not.toContain('secret-session');
  });

  it('a page whose name rebinds to 127.0.0.1 (non-loopback Host) is refused with 421', async () => {
    const { outcome } = await handshake(port, { Host: `rebind.attacker.example:${port}` });
    expect(outcome).toBe('response:421');
  });

  it('any other upgrade path is still closed', async () => {
    const outcome = await new Promise<string>((resolve) => {
      const req = http.request({
        hostname: '127.0.0.1', port, method: 'GET', path: '/ws/other',
        headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==' },
      });
      req.on('upgrade', () => resolve('upgraded'));
      req.on('response', (res) => resolve(`response:${res.statusCode}`));
      req.on('error', () => resolve('closed'));
      req.end();
    });
    expect(outcome).not.toBe('upgraded');
  });
});
