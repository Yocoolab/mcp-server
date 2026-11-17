import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { SelectionStore } from '../selection-store.js';
import { LocalCommentStore } from '../local-comment-store.js';
import { startHttpBridge, type BridgeResult } from '../http-bridge.js';

function request(port: number, method: string, path: string, body?: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: '127.0.0.1', port, method, path, headers: { 'Content-Type': 'application/json' } },
      (res) => { let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => resolve({ status: res.statusCode!, body: d })); }
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

describe('POST /local-comments', () => {
  let bridge: BridgeResult;
  let local: LocalCommentStore;
  let port: number;

  beforeEach(async () => {
    const f = path.join(os.tmpdir(), `yc-bridge-test-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    try { fs.rmSync(f, { force: true }); } catch { /* ignore */ }
    local = new LocalCommentStore(f);
    bridge = startHttpBridge(0, new SelectionStore(), local);
    await new Promise<void>((r) => bridge.server.once('listening', () => { port = (bridge.server.address() as { port: number }).port; r(); }));
  });
  afterEach(async () => { await new Promise<void>((r) => bridge.server.close(() => r())); });

  it('stores pushed threads for the origin and returns the count', async () => {
    const res = await request(port, 'POST', '/local-comments', JSON.stringify({
      type: 'LOCAL_COMMENTS', origin: 'https://shop.com', threads: [{ id: 't1', status: 'open', first_message: 'fix cta' }],
    }));
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true, count: 1 });
    expect(local.get('https://shop.com')?.threads.length).toBe(1);
    expect(local.findThread('t1')?.origin).toBe('https://shop.com');
  });

  it('rejects a payload with no origin', async () => {
    const res = await request(port, 'POST', '/local-comments', JSON.stringify({ threads: [] }));
    expect(res.status).toBe(400);
    expect(local.count()).toBe(0);
  });

  it('rejects invalid JSON', async () => {
    const res = await request(port, 'POST', '/local-comments', 'not json{{');
    expect(res.status).toBe(400);
  });

  it('never stores an auth block the extension may have attached', async () => {
    await request(port, 'POST', '/local-comments', JSON.stringify({
      origin: 'https://shop.com', auth: { token: 'SECRET.JWT', apiUrl: 'https://app.yocoolab.com' },
      threads: [{ id: 't1', status: 'open' }],
    }));
    const snap = local.get('https://shop.com')!;
    expect(JSON.stringify(snap)).not.toContain('SECRET.JWT');
  });

  it('a re-push replaces the origin snapshot (resolved/deleted threads drop out)', async () => {
    const body = (threads: unknown[]) => JSON.stringify({ origin: 'https://shop.com', threads });
    await request(port, 'POST', '/local-comments', body([{ id: 't1' }, { id: 't2' }]));
    await request(port, 'POST', '/local-comments', body([{ id: 't1' }]));
    expect(local.get('https://shop.com')?.threads.length).toBe(1);
    expect(local.findThread('t2')).toBeUndefined();
  });
});
