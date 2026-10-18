import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { SelectionStore } from '../selection-store.js';
import { SessionManager } from '../session-manager.js';
import { startHttpBridge, notificationArgs, type BridgeResult } from '../http-bridge.js';
import type { ActivityEventStore } from '../event-store.js';
import type { ActivityEvent } from '../activity-types.js';

// Mock child_process.execFile to prevent macOS notifications during tests
vi.mock('node:child_process', () => ({
  execFile: vi.fn((_cmd: string, _args: string[], cb: (err: Error | null) => void) => {
    cb(null);
  }),
}));

const execFileMock = vi.mocked(execFile);

/** The argv of every osascript run since the last clear. */
function osascriptRuns(): string[][] {
  return execFileMock.mock.calls.filter((c) => c[0] === 'osascript').map((c) => c[1] as unknown as string[]);
}

/** The AppleScript source of one run: every value that follows an `-e`. */
function scriptSource(args: string[]): string {
  return args.filter((_v, i) => args[i - 1] === '-e').join('\n');
}

/** What the run handler receives: everything after `--`. */
function scriptArgv(args: string[]): string[] | null {
  const at = args.indexOf('--');
  return at === -1 ? null : args.slice(at + 1);
}

function request(
  port: number,
  method: string,
  path: string,
  body?: string,
  headers: Record<string, string> = {}
): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: '127.0.0.1', port, method, path, headers: { 'Content-Type': 'application/json', ...headers } },
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

/** Open the SSE stream, report the response head, hang up. */
function openThreadUpdates(
  port: number,
  headers: Record<string, string> = {}
): Promise<{ status: number; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const req = http.request({ hostname: '127.0.0.1', port, method: 'GET', path: '/thread-updates', headers }, (res) => {
      settled = true;
      resolve({ status: res.statusCode!, headers: res.headers });
      req.destroy();
    });
    req.on('error', (e) => { if (!settled) reject(e); });
    req.end();
  });
}

// The background worker's origin (no host permission for 127.0.0.1), and a
// site the person happens to have open.
const EXT_ORIGIN = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';
const PAGE_ORIGIN = 'https://tfaspa.example';

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

  // Older extension builds put the person's Yocoolab JWT into the Send-to-Agent
  // payload. The store feeds /selections* and get_latest_selection (which prints
  // the payload whole into the agent's transcript), so it must never hold it.
  it('POST /event never stores or serves the payload\'s auth block', async () => {
    const res = await request(port, 'POST', '/event', validPayload({
      correlationId: 'with-auth',
      auth: { token: 'eyJhbGciOiJIUzI1NiJ9.secret-jwt.sig', apiUrl: 'https://app.yocoolab.com' },
    }));
    expect(res.status).toBe(200);
    const stored = store.latest() as unknown as Record<string, unknown>;
    expect(stored.correlationId).toBe('with-auth');
    expect('auth' in stored).toBe(false);
    for (const path of ['/selections/latest', '/selections']) {
      const served = await request(port, 'GET', path);
      expect(served.body).toContain('with-auth');
      expect(served.body).not.toContain('secret-jwt');
      expect(served.body).not.toContain('"auth"');
    }
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

  it('OPTIONS /event preflight from the extension returns 204 and echoes its origin', async () => {
    const res = await request(port, 'OPTIONS', '/event', undefined, {
      Origin: EXT_ORIGIN, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type',
    });
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe(EXT_ORIGIN);
    expect(res.headers['access-control-allow-methods']).toContain('POST');
    expect(res.headers['access-control-allow-headers']).toContain('Content-Type');
    expect(res.headers.vary).toContain('Origin');
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

  // ─── CORS and the origin gate ─────────────────────────────────
  // Callers: comments-ui.js (page MAIN world) fetches GET /agents; background.js
  // POSTs /event and opens the /thread-updates EventSource from
  // chrome-extension://<id>; everything else is curl/Node on this machine.

  const PRIVATE_READS = ['/selections', '/selections/latest', '/companion/messages', '/companion/peek', '/companion/poll-reply'];

  it.each(PRIVATE_READS)('GET %s carries no Access-Control-Allow-Origin for a local caller', async (path) => {
    const res = await request(port, 'GET', path);
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  // The extension never calls these; any other installed extension could.
  it.each(PRIVATE_READS)('GET %s from a browser extension is refused with no CORS headers', async (path) => {
    await request(port, 'POST', '/event', validPayload({ correlationId: 'private-sel' }));
    await request(port, 'POST', '/companion/message', JSON.stringify({ content: 'keep me' }));
    const res = await request(port, 'GET', path, undefined, { Origin: EXT_ORIGIN });
    expect(res.status).toBe(403);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    expect(res.body).not.toContain('private-sel');
    expect(res.body).not.toContain('keep me');
  });

  it.each(PRIVATE_READS)('GET %s from a web page is refused with no CORS headers', async (path) => {
    await request(port, 'POST', '/event', validPayload({ correlationId: 'private-sel' }));
    const res = await request(port, 'GET', path, undefined, { Origin: PAGE_ORIGIN });
    expect(res.status).toBe(403);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    expect(res.body).not.toContain('private-sel');
  });

  it('a no-cors GET from a page (no Origin, Sec-Fetch-Site: cross-site) cannot drain the companion queue', async () => {
    await request(port, 'POST', '/companion/message', JSON.stringify({ content: 'keep me' }));
    const res = await request(port, 'GET', '/companion/messages', undefined, { 'Sec-Fetch-Site': 'cross-site' });
    expect(res.status).toBe(403);
    const local = await request(port, 'GET', '/companion/messages');
    expect(JSON.parse(local.body).messages.map((m: { content: string }) => m.content)).toEqual(['keep me']);
  });

  it.each(['/agents', '/health'])('GET %s answers any page with Access-Control-Allow-Origin: *', async (path) => {
    const res = await request(port, 'GET', path, undefined, { Origin: PAGE_ORIGIN });
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('*');
  });

  it('a page-world preflight on GET /agents grants Private Network Access only when asked', async () => {
    const asked = await request(port, 'OPTIONS', '/agents', undefined, {
      Origin: PAGE_ORIGIN, 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Private-Network': 'true',
    });
    expect(asked.status).toBe(204);
    expect(asked.headers['access-control-allow-origin']).toBe('*');
    expect(asked.headers['access-control-allow-private-network']).toBe('true');
    const plain = await request(port, 'OPTIONS', '/agents', undefined, { Origin: PAGE_ORIGIN, 'Access-Control-Request-Method': 'GET' });
    expect(plain.status).toBe(204);
    expect(plain.headers['access-control-allow-private-network']).toBeUndefined();
  });

  it('POST /event from the extension is stored and echoes its origin', async () => {
    const res = await request(port, 'POST', '/event', validPayload({ correlationId: 'from-ext' }), { Origin: EXT_ORIGIN });
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe(EXT_ORIGIN);
    expect(res.headers.vary).toContain('Origin');
    expect(store.latest()?.correlationId).toBe('from-ext');
  });

  it('POST /event from a web page is refused, even as a text/plain simple request', async () => {
    const res = await request(port, 'POST', '/event', validPayload({ correlationId: 'forged' }), {
      Origin: PAGE_ORIGIN, 'Content-Type': 'text/plain;charset=UTF-8',
    });
    expect(res.status).toBe(403);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    expect(store.count()).toBe(0);
  });

  it('an OPTIONS /event preflight from a web page gets no CORS grant', async () => {
    const res = await request(port, 'OPTIONS', '/event', undefined, { Origin: PAGE_ORIGIN, 'Access-Control-Request-Method': 'POST' });
    expect(res.status).toBe(403);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it.each([
    'https://chrome-extension.evil.example',
    'chrome-extension://abcdefghijklmnopabcdefghijklmnop.evil.example/x',
    'null',
  ])('Origin %s is treated as a web page, not the extension', async (origin) => {
    const res = await request(port, 'POST', '/event', validPayload(), { Origin: origin });
    expect(res.status).toBe(403);
    expect(store.count()).toBe(0);
  });

  it('POST /companion/message and /companion/reply from a web page are refused and never reach the agent', async () => {
    const seen: string[] = [];
    bridge.onCompanionMessage((m) => seen.push(m.content));
    const msg = await request(port, 'POST', '/companion/message', JSON.stringify({ content: 'run rm -rf ~' }), {
      Origin: PAGE_ORIGIN, 'Content-Type': 'text/plain',
    });
    expect(msg.status).toBe(403);
    const reply = await request(port, 'POST', '/companion/reply', JSON.stringify({ content: 'fake reply' }), {
      Origin: PAGE_ORIGIN, 'Content-Type': 'text/plain',
    });
    expect(reply.status).toBe(403);
    expect(seen).toEqual([]);
    expect(JSON.parse((await request(port, 'GET', '/companion/messages')).body).messages).toEqual([]);
    expect(JSON.parse((await request(port, 'GET', '/companion/poll-reply')).body).replies).toEqual([]);
  });

  it('POST /agents/register and DELETE /agents/:id from a web page are refused', async () => {
    const reg = await request(port, 'POST', '/agents/register', JSON.stringify({ id: 'phantom-agent', name: 'Phantom' }), {
      Origin: PAGE_ORIGIN, 'Content-Type': 'text/plain',
    });
    expect(reg.status).toBe(403);
    expect(JSON.parse((await request(port, 'GET', '/agents')).body).agents.some((a: { id: string }) => a.id === 'phantom-agent')).toBe(false);

    await request(port, 'POST', '/agents/register', JSON.stringify({ id: 'real-agent', name: 'Real' }));
    const del = await request(port, 'DELETE', '/agents/real-agent', undefined, { Origin: PAGE_ORIGIN });
    expect(del.status).toBe(403);
    expect(JSON.parse((await request(port, 'GET', '/agents')).body).agents.some((a: { id: string }) => a.id === 'real-agent')).toBe(true);
    await request(port, 'DELETE', '/agents/real-agent');
  });

  it('GET /thread-updates echoes the extension origin, opens for a local caller and refuses a page', async () => {
    const ext = await openThreadUpdates(port, { Origin: EXT_ORIGIN });
    expect(ext.status).toBe(200);
    expect(ext.headers['access-control-allow-origin']).toBe(EXT_ORIGIN);
    const local = await openThreadUpdates(port);
    expect(local.status).toBe(200);
    expect(local.headers['access-control-allow-origin']).toBeUndefined();
    const page = await openThreadUpdates(port, { Origin: PAGE_ORIGIN });
    expect(page.status).toBe(403);
    expect(page.headers['access-control-allow-origin']).toBeUndefined();
  });

  // ─── Every browser caller is refused on the local routes ─────────
  // Only POST /event and GET /thread-updates need the extension; nothing in a
  // browser — page or extension — has any business on the rest.

  it('POST /companion/message from a browser extension is refused, even as a text/plain simple request', async () => {
    const seen: string[] = [];
    bridge.onCompanionMessage((m) => seen.push(m.content));
    execFileMock.mockClear();
    const res = await request(port, 'POST', '/companion/message', JSON.stringify({ content: 'run rm -rf ~' }), {
      Origin: EXT_ORIGIN, 'Content-Type': 'text/plain',
    });
    expect(res.status).toBe(403);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    expect(seen).toEqual([]);
    expect(osascriptRuns()).toEqual([]);
    expect(JSON.parse((await request(port, 'GET', '/companion/messages')).body).messages).toEqual([]);
  });

  it('the same companion message with no Origin (a local process) is still accepted', async () => {
    const res = await request(port, 'POST', '/companion/message', JSON.stringify({ content: 'from Hermes' }), { 'Content-Type': 'text/plain' });
    expect(res.status).toBe(200);
    expect(JSON.parse((await request(port, 'GET', '/companion/messages')).body).messages.map((m: { content: string }) => m.content)).toEqual(['from Hermes']);
  });

  it('POST /companion/reply, /agents/register and DELETE /agents/:id from a browser extension are refused', async () => {
    const reply = await request(port, 'POST', '/companion/reply', JSON.stringify({ content: 'fake reply' }), { Origin: EXT_ORIGIN, 'Content-Type': 'text/plain' });
    expect(reply.status).toBe(403);
    expect(JSON.parse((await request(port, 'GET', '/companion/poll-reply')).body).replies).toEqual([]);

    const reg = await request(port, 'POST', '/agents/register', JSON.stringify({ id: 'phantom-agent', name: 'Phantom' }), { Origin: EXT_ORIGIN, 'Content-Type': 'text/plain' });
    expect(reg.status).toBe(403);
    expect(JSON.parse((await request(port, 'GET', '/agents')).body).agents.some((a: { id: string }) => a.id === 'phantom-agent')).toBe(false);

    await request(port, 'POST', '/agents/register', JSON.stringify({ id: 'real-agent', name: 'Real' }));
    const del = await request(port, 'DELETE', '/agents/real-agent', undefined, { Origin: EXT_ORIGIN });
    expect(del.status).toBe(403);
    expect(JSON.parse((await request(port, 'GET', '/agents')).body).agents.some((a: { id: string }) => a.id === 'real-agent')).toBe(true);
    await request(port, 'DELETE', '/agents/real-agent');
  });

  // An extension holding a host permission for 127.0.0.1 sends its GETs with
  // no Origin and `Sec-Fetch-Site: none` (checked in Chromium). So does an
  // address typed into the browser. Neither is a local process.
  it('a browser-started request with no Origin (Sec-Fetch-Site: none) cannot read or drain the local routes', async () => {
    await request(port, 'POST', '/companion/message', JSON.stringify({ content: 'keep me' }));
    for (const path of PRIVATE_READS) {
      const res = await request(port, 'GET', path, undefined, { 'Sec-Fetch-Site': 'none', 'Sec-Fetch-Mode': 'cors' });
      expect(res.status, path).toBe(403);
    }
    const local = await request(port, 'GET', '/companion/messages');
    expect(JSON.parse(local.body).messages.map((m: { content: string }) => m.content)).toEqual(['keep me']);
  });

  it('the extension holding a host permission still gets /thread-updates and POST /event', async () => {
    const sse = await openThreadUpdates(port, { 'Sec-Fetch-Site': 'none', 'Sec-Fetch-Mode': 'cors' });
    expect(sse.status).toBe(200);
    // No Origin to echo, and none needed: a host permission skips CORS.
    expect(sse.headers['access-control-allow-origin']).toBeUndefined();
    // Its POSTs carry the extension Origin (and Sec-Fetch-Site: none).
    const post = await request(port, 'POST', '/event', validPayload({ correlationId: 'host-perm' }), { Origin: EXT_ORIGIN, 'Sec-Fetch-Site': 'none' });
    expect(post.status).toBe(200);
    expect(store.latest()?.correlationId).toBe('host-perm');
  });

  it.each(['same-origin', 'same-site', 'cross-site'])('Sec-Fetch-Site: %s with no Origin is a web page', async (site) => {
    await request(port, 'POST', '/event', validPayload({ correlationId: 'private-sel' }));
    const res = await request(port, 'GET', '/selections/latest', undefined, { 'Sec-Fetch-Site': site });
    expect(res.status).toBe(403);
    expect(res.body).not.toContain('private-sel');
    const ev = await openThreadUpdates(port, { 'Sec-Fetch-Site': site });
    expect(ev.status).toBe(403);
  });

  it('Node fetch (Sec-Fetch-Mode but no Sec-Fetch-Site) is still a local caller', async () => {
    const res = await request(port, 'GET', '/selections/latest', undefined, { 'Sec-Fetch-Mode': 'cors' });
    expect(res.status).toBe(200);
  });

  // ─── Host: only loopback names (DNS rebinding) ──────────────────
  // A page whose name rebinds to 127.0.0.1 makes same-origin requests: no
  // Origin, and — the page is not a secure context — no Sec-Fetch-* either.
  // Only the Host header still carries the page's own name.
  const REBIND = 'rebind.attacker.example';

  it.each(PRIVATE_READS)('GET %s with a non-loopback Host is refused with 421', async (path) => {
    await request(port, 'POST', '/event', validPayload({ correlationId: 'private-sel' }));
    const res = await request(port, 'GET', path, undefined, { Host: `${REBIND}:${port}` });
    expect(res.status).toBe(421);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    expect(res.body).not.toContain('private-sel');
  });

  it('a rebinding page cannot drain the companion queue', async () => {
    await request(port, 'POST', '/companion/message', JSON.stringify({ content: 'keep me' }));
    const res = await request(port, 'GET', '/companion/messages', undefined, { Host: `${REBIND}:${port}`, 'Sec-Fetch-Site': 'same-origin' });
    expect(res.status).toBe(421);
    const local = await request(port, 'GET', '/companion/messages', undefined, { Host: `127.0.0.1:${port}` });
    expect(JSON.parse(local.body).messages.map((m: { content: string }) => m.content)).toEqual(['keep me']);
  });

  it('every route checks Host, the page-world and extension ones too', async () => {
    expect((await request(port, 'GET', '/agents', undefined, { Host: `${REBIND}:${port}` })).status).toBe(421);
    expect((await request(port, 'GET', '/health', undefined, { Host: REBIND })).status).toBe(421);
    const ev = await request(port, 'POST', '/event', validPayload(), { Host: `${REBIND}:${port}`, Origin: `http://${REBIND}:${port}` });
    expect(ev.status).toBe(421);
    expect(store.count()).toBe(0);
    expect((await request(port, 'OPTIONS', '/event', undefined, { Host: REBIND, Origin: EXT_ORIGIN, 'Access-Control-Request-Method': 'POST' })).status).toBe(421);
  });

  it.each(['127.0.0.1', 'localhost', 'LocalHost', '[::1]'])('Host %s (with or without the port) is served', async (name) => {
    expect((await request(port, 'GET', '/health', undefined, { Host: `${name}:${port}` })).status).toBe(200);
    expect((await request(port, 'GET', '/health', undefined, { Host: name })).status).toBe(200);
  });

  it.each([
    'localhost.rebind.attacker.example',
    '127.0.0.1.nip.io',
    '[::1].attacker.example',
    '127.0.0.2',
    '0.0.0.0',
    'localhost.',
  ])('Host %s is refused', async (name) => {
    const res = await request(port, 'GET', '/health', undefined, { Host: `${name}:${port}` });
    expect(res.status).toBe(421);
  });

  // ─── macOS notifications: text is an argument, never AppleScript ──

  it('notificationArgs runs one fixed script and passes title, subtitle and text as its arguments', () => {
    const text = 'x\\" & (do shell script "id") & \\"';
    const args = notificationArgs(text, 'Yocoolab Companion', 'New message');
    expect(scriptSource(args)).toBe('on run argv\ndisplay notification (item 1 of argv) with title (item 2 of argv) subtitle (item 3 of argv)\nend run');
    expect(scriptArgv(args)).toEqual([text, 'Yocoolab Companion', 'New message']);
  });

  it('a companion message with a backslash before a quote never becomes AppleScript source', async () => {
    execFileMock.mockClear();
    // On the old builder (quotes escaped, backslashes not) this closes the
    // string literal and runs `do shell script`.
    const content = 'hi\\" & (do shell script "id > /tmp/yc-pwned") & \\"';
    const res = await request(port, 'POST', '/companion/message', JSON.stringify({ content }));
    expect(res.status).toBe(200);
    const runs = osascriptRuns();
    expect(runs).toHaveLength(1);
    expect(scriptSource(runs[0])).not.toContain('do shell script');
    expect(scriptArgv(runs[0])).toEqual([content, 'Yocoolab Companion', 'New message']);
  });

  it('a selection\'s element text and page path reach the notification as an argument only', async () => {
    execFileMock.mockClear();
    const text = 'Say \\"hi\\" & (do shell script "id") & "';
    const res = await request(port, 'POST', '/event', JSON.stringify({
      type: 'ELEMENT_SELECTED',
      element: { tag: 'BUTTON', selector: 'button', text },
      page: { url: 'https://example.com/a%22b/c' },
    }));
    expect(res.status).toBe(200);
    const runs = osascriptRuns();
    expect(runs).toHaveLength(1);
    expect(scriptSource(runs[0])).not.toContain('do shell script');
    expect(scriptSource(runs[0])).not.toContain('example');
    const argv = scriptArgv(runs[0])!;
    expect(argv[0]).toBe(`<BUTTON> "${text}" on /a%22b/c`);
    expect(argv.slice(1)).toEqual(['Yocoolab Bridge', 'Element captured']);
  });

  // ─── 2.x: the activity monitor ───────────────────────────────
  // The hooks POST every Claude Code event (prompts, tool inputs and outputs)
  // to /monitor/events over curl; extension builds before 1.9.202 read
  // /monitor/api/* from the background worker. A web page must get neither.

  const MONITOR_READS = ['/monitor/api/events/recent', '/monitor/api/sessions'];

  async function seedMonitor(): Promise<void> {
    await request(port, 'POST', '/monitor/events', JSON.stringify({ session_id: 'secret-session', hook_event_name: 'UserPromptSubmit', prompt: 'my private prompt', cwd: '/Users/someone/repo' }));
  }

  it.each(MONITOR_READS)('GET %s serves a local caller with no CORS headers', async (path) => {
    await seedMonitor();
    const res = await request(port, 'GET', path);
    expect(res.status).toBe(200);
    expect(res.body).toContain('secret-session');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it.each(MONITOR_READS)('GET %s serves the extension and echoes its origin', async (path) => {
    await seedMonitor();
    const res = await request(port, 'GET', path, undefined, { Origin: EXT_ORIGIN });
    expect(res.status).toBe(200);
    expect(res.body).toContain('secret-session');
    expect(res.headers['access-control-allow-origin']).toBe(EXT_ORIGIN);
  });

  it.each(MONITOR_READS)('GET %s from a web page is refused with no CORS headers', async (path) => {
    await seedMonitor();
    for (const headers of [{ Origin: PAGE_ORIGIN }, { 'Sec-Fetch-Site': 'cross-site' }]) {
      const res = await request(port, 'GET', path, undefined, headers);
      expect(res.status).toBe(403);
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
      expect(res.body).not.toContain('secret-session');
      expect(res.body).not.toContain('my private prompt');
    }
  });

  it('POST /monitor/events from a web page is refused and records nothing', async () => {
    const res = await request(port, 'POST', '/monitor/events', JSON.stringify({ session_id: 'forged', hook_event_name: 'Stop' }), {
      Origin: PAGE_ORIGIN, 'Content-Type': 'text/plain',
    });
    expect(res.status).toBe(403);
    expect(events.count()).toBe(0);
  });

  it.each(MONITOR_READS)('GET %s with a non-loopback Host (DNS rebinding) is refused with 421', async (path) => {
    await seedMonitor();
    const res = await request(port, 'GET', path, undefined, { Host: `${REBIND}:${port}` });
    expect(res.status).toBe(421);
    expect(res.body).not.toContain('secret-session');
    expect(res.body).not.toContain('my private prompt');
  });

  it('POST /monitor/events from any installed extension is refused: only the hooks post events', async () => {
    for (const headers of [{ Origin: EXT_ORIGIN }, { 'Sec-Fetch-Site': 'none' }]) {
      const res = await request(port, 'POST', '/monitor/events', JSON.stringify({ session_id: 'forged', hook_event_name: 'Stop' }), headers);
      expect(res.status).toBe(403);
    }
    expect(events.count()).toBe(0);
  });

  it.each(MONITOR_READS)('GET %s still serves an extension that holds a host permission (no Origin, Sec-Fetch-Site: none)', async (path) => {
    await seedMonitor();
    const res = await request(port, 'GET', path, undefined, { 'Sec-Fetch-Site': 'none' });
    expect(res.status).toBe(200);
    expect(res.body).toContain('secret-session');
  });

  it('GET /dashboard/ still loads from a link on another site, with no CORS grant', async () => {
    const res = await request(port, 'GET', '/dashboard/', undefined, { 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'navigate' });
    expect(res.status).not.toBe(403);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});
