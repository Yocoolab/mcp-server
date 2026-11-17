import { describe, it, expect } from 'vitest';
import { LocalCommentStore } from '../../local-comment-store.js';
import { handleListLocalThreads, handleGetLocalComments } from '../../tools/local-comments.js';

function thread(id: string, over: Record<string, unknown> = {}) {
  return {
    id, status: 'open', first_message: `fix ${id}`,
    element_tag: 'BUTTON', element_text: 'Buy now', selector: `button#${id}`, xpath: `//button[@id="${id}"]`,
    page_url: 'https://shop.com/cart', element_context: '<button class="cta">Buy now</button>',
    messages: [{ content: `fix ${id}`, author_name: 'You' }],
    ...over,
  };
}

describe('list_local_threads', () => {
  it('invites the person to comment when the store is empty', () => {
    const r = handleListLocalThreads(new LocalCommentStore(), {});
    expect(r.content[0].text).toMatch(/no account|without an account|No local comments/i);
  });

  it('lists open threads with element, selector and page', () => {
    const s = new LocalCommentStore();
    s.set('https://shop.com', { threads: [thread('t1')] });
    const r = handleListLocalThreads(s, {});
    expect(r.content[0].text).toContain('t1');
    expect(r.content[0].text).toContain('button#t1');
    expect(r.content[0].text).toContain('Buy now');
    expect(r.content[0].text).toContain('https://shop.com');
  });

  it('hides resolved threads unless include_resolved is set', () => {
    const s = new LocalCommentStore();
    s.set('https://shop.com', { threads: [thread('open1'), thread('done1', { status: 'resolved' })] });
    expect(handleListLocalThreads(s, {}).content[0].text).not.toContain('done1');
    expect(handleListLocalThreads(s, { include_resolved: true }).content[0].text).toContain('done1');
  });

  it('filters by origin', () => {
    const s = new LocalCommentStore();
    s.set('https://a.com', { threads: [thread('a1')] });
    s.set('https://b.com', { threads: [thread('b1')] });
    const r = handleListLocalThreads(s, { origin: 'https://b.com' });
    expect(r.content[0].text).toContain('b1');
    expect(r.content[0].text).not.toContain('a1');
  });
});

describe('get_local_comments', () => {
  it('returns full detail (xpath, context, conversation) for a thread id', () => {
    const s = new LocalCommentStore();
    s.set('https://shop.com', { threads: [thread('t1', { messages: [{ content: 'make it green', author_name: 'You' }, { content: 'and bigger', author_name: 'You' }] })] });
    const r = handleGetLocalComments(s, { thread_id: 't1' });
    expect(r.content[0].text).toContain('//button[@id="t1"]');
    expect(r.content[0].text).toContain('element context');
    expect(r.content[0].text).toContain('and bigger');
  });

  it('falls back to all open threads on the most-recent page', () => {
    const s = new LocalCommentStore();
    s.set('https://shop.com', { threads: [thread('t1'), thread('t2')] });
    const r = handleGetLocalComments(s, {});
    expect(r.content[0].text).toContain('2 open local comment');
    expect(r.content[0].text).toContain('t1');
    expect(r.content[0].text).toContain('t2');
  });

  it('reports a clear miss for an unknown thread id', () => {
    const r = handleGetLocalComments(new LocalCommentStore(), { thread_id: 'nope' });
    expect(r.content[0].text).toContain('nope');
  });
});
