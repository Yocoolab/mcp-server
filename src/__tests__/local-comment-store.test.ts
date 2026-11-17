import { describe, it, expect } from 'vitest';
import { LocalCommentStore } from '../local-comment-store.js';

function thread(id: string, over: Record<string, unknown> = {}) {
  return { id, status: 'open', first_message: `note ${id}`, element_tag: 'BUTTON', selector: `#${id}`, messages: [{ content: `note ${id}`, author_name: 'You' }], ...over };
}

describe('LocalCommentStore', () => {
  it('stores and returns a snapshot per origin', () => {
    const s = new LocalCommentStore();
    s.set('https://a.com', { threads: [thread('t1')] });
    expect(s.get('https://a.com')?.threads.length).toBe(1);
    expect(s.count()).toBe(1);
  });

  it('replaces (not appends) an origin snapshot on re-push', () => {
    const s = new LocalCommentStore();
    s.set('https://a.com', { threads: [thread('t1'), thread('t2')] });
    s.set('https://a.com', { threads: [thread('t1')] }); // t2 resolved/deleted upstream
    expect(s.count()).toBe(1);
    expect(s.findThread('t2')).toBeUndefined();
  });

  it('orders origins most-recently-updated first and reports latest()', async () => {
    const s = new LocalCommentStore();
    s.set('https://old.com', { threads: [thread('o1')] });
    await new Promise((r) => setTimeout(r, 2));
    s.set('https://new.com', { threads: [thread('n1')] });
    expect(s.latest()?.origin).toBe('https://new.com');
    expect(s.origins()[0].origin).toBe('https://new.com');
  });

  it('omits origins that have zero threads', () => {
    const s = new LocalCommentStore();
    s.set('https://a.com', { threads: [] });
    expect(s.origins()).toHaveLength(0);
    expect(s.latest()).toBeNull();
  });

  it('finds a thread by id across origins', () => {
    const s = new LocalCommentStore();
    s.set('https://a.com', { threads: [thread('a1')] });
    s.set('https://b.com', { threads: [thread('b1')] });
    expect(s.findThread('b1')?.origin).toBe('https://b.com');
    expect(s.findThread('missing')).toBeUndefined();
  });

  it('tolerates a non-array threads value', () => {
    const s = new LocalCommentStore();
    // @ts-expect-error — defensive against a malformed push
    s.set('https://a.com', { threads: null });
    expect(s.count()).toBe(0);
  });
});
