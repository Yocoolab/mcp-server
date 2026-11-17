import { describe, it, expect } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { LocalCommentStore } from '../local-comment-store.js';

let n = 0;
/** A store backed by a unique temp file, so tests never share the real shared file. */
function freshStore(): LocalCommentStore {
  const f = path.join(os.tmpdir(), `yc-local-test-${process.pid}-${Date.now()}-${n++}.json`);
  try { fs.rmSync(f, { force: true }); } catch { /* ignore */ }
  return new LocalCommentStore(f);
}

function thread(id: string, over: Record<string, unknown> = {}) {
  return { id, status: 'open', first_message: `note ${id}`, element_tag: 'BUTTON', selector: `#${id}`, messages: [{ content: `note ${id}`, author_name: 'You' }], ...over };
}

describe('LocalCommentStore', () => {
  it('stores and returns a snapshot per origin', () => {
    const s = freshStore();
    s.set('https://a.com', { threads: [thread('t1')] });
    expect(s.get('https://a.com')?.threads.length).toBe(1);
    expect(s.count()).toBe(1);
  });

  it('replaces (not appends) an origin snapshot on re-push', () => {
    const s = freshStore();
    s.set('https://a.com', { threads: [thread('t1'), thread('t2')] });
    s.set('https://a.com', { threads: [thread('t1')] }); // t2 resolved/deleted upstream
    expect(s.count()).toBe(1);
    expect(s.findThread('t2')).toBeUndefined();
  });

  it('orders origins most-recently-updated first and reports latest()', async () => {
    const s = freshStore();
    s.set('https://old.com', { threads: [thread('o1')] });
    await new Promise((r) => setTimeout(r, 2));
    s.set('https://new.com', { threads: [thread('n1')] });
    expect(s.latest()?.origin).toBe('https://new.com');
    expect(s.origins()[0].origin).toBe('https://new.com');
  });

  it('omits origins that have zero threads', () => {
    const s = freshStore();
    s.set('https://a.com', { threads: [] });
    expect(s.origins()).toHaveLength(0);
    expect(s.latest()).toBeNull();
  });

  it('finds a thread by id across origins', () => {
    const s = freshStore();
    s.set('https://a.com', { threads: [thread('a1')] });
    s.set('https://b.com', { threads: [thread('b1')] });
    expect(s.findThread('b1')?.origin).toBe('https://b.com');
    expect(s.findThread('missing')).toBeUndefined();
  });

  it('tolerates a non-array threads value', () => {
    const s = freshStore();
    // @ts-expect-error — defensive against a malformed push
    s.set('https://a.com', { threads: null });
    expect(s.count()).toBe(0);
  });

  it('shares state across instances via the file (the multi-process guarantee)', () => {
    // Two LocalCommentStore instances on the SAME file = two mcp-server
    // processes. One receives the push (owns the bridge); the OTHER (the
    // agent's server) must read it.
    const f = path.join(os.tmpdir(), `yc-shared-${process.pid}-${Date.now()}.json`);
    try { fs.rmSync(f, { force: true }); } catch { /* ignore */ }
    const bridgeSide = new LocalCommentStore(f);
    const agentSide = new LocalCommentStore(f);
    bridgeSide.set('https://shop.com', { threads: [thread('x1')] });
    expect(agentSide.findThread('x1')?.origin).toBe('https://shop.com');
    expect(agentSide.count()).toBe(1);
  });

  it('tolerates a missing/corrupt file (reads empty, never throws)', () => {
    const s = new LocalCommentStore(path.join(os.tmpdir(), `yc-missing-${process.pid}-${Date.now()}.json`));
    expect(s.count()).toBe(0);
    expect(s.latest()).toBeNull();
    expect(s.allThreads()).toEqual([]);
  });
});
