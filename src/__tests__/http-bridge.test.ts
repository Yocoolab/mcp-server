import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import http from 'node:http';
import { SelectionStore } from '../selection-store.js';
import { SessionManager } from '../session-manager.js';
import { startHttpBridge, type BridgeResult } from '../http-bridge.js';
import type { ActivityEventStore } from '../event-store.js';
import type { ActivityEvent } from '../activity-types.js';

// Mock child_process.execFile to prevent macOS notifications during tests
vi.mock('node:child_process', () => ({
  execFile: vi.fn((_cmd: string, _args: string[], cb: (err: Error | null) => void) => {
    cb(null);
  }),
}));

function request(
  port: number,
  method: string,
  path: string,
  body?: string
): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: '127.0.0.1', port, method, path, headers: { 'Content-Type': 'application/json' } },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => resolve({ status: res.statusCode!, body: data, headers: res.headers }));
      }
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function validPayload(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    type: 'ELEMENT_SELECTED',
    element: { tag: 'BUTTON', selector: 'button.test', id: '', classList: [], text: 'Click', attributes: {}, domPath: [], boundingBox: { x: 0, y: 0, w: 100, h: 40 } },
    page: { url: 'https://example.com', title: 'Test', viewport: { w: 1920, h: 1080 }, devicePixelRatio: 1 },
    styles: { computed: {} },
    hints: { frameworkGuess: 'unknown', devServer: 'unknown' },
    ...overrides,
  });
}

/**
 * The activity store without its disk side: the real one appends every event
 * to ~/.yocoolab-mcp/events.jsonl, which a test must never touch.
 */
function memoryEventStore(): ActivityEventStore {
  const events: ActivityEvent[] = [];
  return {
    push: (e: ActivityEvent) => { events.push(e); },
    recent: (limit = 200) => events.slice(Math.max(0, events.length - limit)),
    count: () => events.length,
    loadFromDisk: () => {},
    close: () => {},
  } as unknown as ActivityEventStore;
}

describe('HTTP Bridge', () => {
  let bridge: BridgeResult;
  let server: http.Server;
  let store: SelectionStore;
  let events: ActivityEventStore;
  let port: number;

  beforeEach(async () => {
    store = new SelectionStore();
    events = memoryEventStore();
    // Port 0 → random free port; startHttpBridge calls listen() synchronously
    bridge = startHttpBridge(0, store, events, new SessionManager());
    server = bridge.server;
    await new Promise<void>((resolve) => {
      server.once('listening', () => {
        port = (server.address() as { port: number }).port;
        resolve();
      });
    });
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('GET /health returns status ok with bridge and monitor stats', async () => {
    const res = await request(port, 'GET', '/health');
    expect(res.status).toBe(200);
    const json = JSON.parse(res.body);
    expect(json.status).toBe('ok');
    expect(json.bridge.selections).toBe(0);
    expect(json.bridge.sseClients).toBe(0);
    expect(Array.isArray(json.bridge.agents)).toBe(true);
    expect(json.monitor).toEqual({ events: 0, sessions: 0 });
  });

  it('POST /event with valid payload returns 200 and correlationId', async () => {
    const res = await request(port, 'POST', '/event', validPayload());
    expect(res.status).toBe(200);
    const json = JSON.parse(res.body);
    expect(json.ok).toBe(true);
    expect(json.correlationId).toBeDefined();
    expect(store.count()).toBe(1);
  });

  it('POST /event with invalid JSON returns 400', async () => {
    const res = await request(port, 'POST', '/event', 'not json{{{');
    expect(res.status).toBe(400);
    const json = JSON.parse(res.body);
    expect(json.error).toBe('Invalid JSON');
  });

  it('POST /event with missing type field returns 400', async () => {
    const res = await request(port, 'POST', '/event', JSON.stringify({
      element: { tag: 'DIV' },
      page: { url: 'https://example.com' },
    }));
    expect(res.status).toBe(400);
    const json = JSON.parse(res.body);
    expect(json.error).toBe('Invalid payload');
  });

  it('POST /event with missing element returns 400', async () => {
    const res = await request(port, 'POST', '/event', JSON.stringify({
      type: 'ELEMENT_SELECTED',
      page: { url: 'https://example.com' },
    }));
    expect(res.status).toBe(400);
  });

  it('POST /event with missing page returns 400', async () => {
    const res = await request(port, 'POST', '/event', JSON.stringify({
      type: 'ELEMENT_SELECTED',
      element: { tag: 'DIV' },
    }));
    expect(res.status).toBe(400);
  });

  it('POST /event generates correlationId if not provided', async () => {
    const res = await request(port, 'POST', '/event', validPayload());
    const json = JSON.parse(res.body);
    expect(json.correlationId).toMatch(/^[0-9a-f-]+$/);
  });

  it('POST /event preserves correlationId if provided', async () => {
    const res = await request(port, 'POST', '/event', validPayload({ correlationId: 'my-custom-id' }));
    const json = JSON.parse(res.body);
    expect(json.correlationId).toBe('my-custom-id');
  });

  it('POST /event adds timestamp if not provided', async () => {
    await request(port, 'POST', '/event', validPayload());
    const latest = store.latest()!;
    expect(latest.timestamp).toBeDefined();
    expect(typeof latest.timestamp).toBe('number');
  });

  it('GET /selections/latest returns null when empty', async () => {
    const res = await request(port, 'GET', '/selections/latest');
    expect(res.status).toBe(200);
    const json = JSON.parse(res.body);
    expect(json.selection).toBeNull();
  });

  it('GET /selections/latest returns most recent selection', async () => {
    await request(port, 'POST', '/event', validPayload({ correlationId: 'sel-1' }));
    await request(port, 'POST', '/event', validPayload({ correlationId: 'sel-2' }));

    const res = await request(port, 'GET', '/selections/latest');
    expect(res.status).toBe(200);
    const json = JSON.parse(res.body);
    expect(json.selection.correlationId).toBe('sel-2');
  });

  it('GET /selections?limit=N returns selections in reverse order', async () => {
    await request(port, 'POST', '/event', validPayload({ correlationId: 'a' }));
    await request(port, 'POST', '/event', validPayload({ correlationId: 'b' }));
    await request(port, 'POST', '/event', validPayload({ correlationId: 'c' }));

    const res = await request(port, 'GET', '/selections?limit=2');
    expect(res.status).toBe(200);
    const json = JSON.parse(res.body);
    expect(json.selections).toHaveLength(2);
    expect(json.selections[0].correlationId).toBe('c');
    expect(json.selections[1].correlationId).toBe('b');
  });

  it('OPTIONS /event returns 204 with CORS headers', async () => {
    const res = await request(port, 'OPTIONS', '/event');
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('*');
    expect(res.headers['access-control-allow-methods']).toContain('POST');
  });

  it('unknown route returns 404', async () => {
    const res = await request(port, 'GET', '/unknown');
    expect(res.status).toBe(404);
  });

  it('GET /health reflects selection count after POST', async () => {
    await request(port, 'POST', '/event', validPayload());
    await request(port, 'POST', '/event', validPayload());
    const res = await request(port, 'GET', '/health');
    expect(JSON.parse(res.body).bridge.selections).toBe(2);
  });

  it('agent registry: register then list', async () => {
    const reg = await request(port, 'POST', '/agents/register', JSON.stringify({ id: 'test-agent', name: 'Test', type: 'custom' }));
    expect(reg.status).toBe(200);
    const list = await request(port, 'GET', '/agents');
    expect(list.status).toBe(200);
    expect(JSON.parse(list.body).agents.some((a: { id: string }) => a.id === 'test-agent')).toBe(true);
    await request(port, 'DELETE', '/agents/test-agent');
  });

  it('companion: POST /companion/message is readable via GET /companion/messages', async () => {
    const post = await request(port, 'POST', '/companion/message', JSON.stringify({ content: 'hello agent' }));
    expect(post.status).toBe(200);
    const res = await request(port, 'GET', '/companion/messages');
    const json = JSON.parse(res.body);
    expect(json.messages).toHaveLength(1);
    expect(json.messages[0].content).toBe('hello agent');
  });

  it('activity monitor: a hook event posted to /monitor/events is served by /monitor/api/*', async () => {
    const post = await request(port, 'POST', '/monitor/events', JSON.stringify({ session_id: 's1', hook_event_name: 'Stop', cwd: '/tmp/repo' }));
    expect(post.status).toBe(200);
    expect(events.count()).toBe(1);
    const recent = JSON.parse((await request(port, 'GET', '/monitor/api/events/recent')).body);
    expect(recent[0].session_id).toBe('s1');
    const sessions = JSON.parse((await request(port, 'GET', '/monitor/api/sessions')).body);
    expect(sessions[0].session_id).toBe('s1');
  });
});
