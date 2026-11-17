import { describe, it, expect } from 'vitest';
import { LocalCommentStore } from '../../local-comment-store.js';
import { handleListLocalThreads, handleGetLocalComments, handleCreateLocalComments } from '../../tools/local-comments.js';

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

  it('marks threads handed off to an agent as pending, and pending_only filters to them', () => {
    const s = new LocalCommentStore();
    s.set('https://shop.com', { threads: [
      thread('p1', { claude_code_pending: true, target_agent_type: 'claude-code' }),
      thread('idle1'),
    ] });
    const all = handleListLocalThreads(s, {}).content[0].text;
    expect(all).toContain('pending for claude-code');
    const pend = handleListLocalThreads(s, { pending_only: true }).content[0].text;
    expect(pend).toContain('p1');
    expect(pend).not.toContain('idle1');
  });

  it('pending_only with nothing pending explains how a comment becomes pending', () => {
    const s = new LocalCommentStore();
    s.set('https://shop.com', { threads: [thread('idle1')] });
    expect(handleListLocalThreads(s, { pending_only: true }).content[0].text).toMatch(/Agent Build It|pending/i);
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

describe('create_local_comments', () => {
  it('maps items and reports how many reached the browser', () => {
    let got: Array<Record<string, unknown>> = [];
    const emit = (items: Array<Record<string, unknown>>) => { got = items; return 1; };
    const r = handleCreateLocalComments(emit, { comments: [
      { comment: 'Make the CTA green', page_url: 'https://acme.app/', selector: '.cta', priority: 'high' },
      { comment: '   ', page_url: 'https://acme.app/' }, // dropped
    ] });
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ message: 'Make the CTA green', selector: '.cta', priority: 'high', page_url: 'https://acme.app/' });
    expect(r.content[0].text).toMatch(/Sent 1 pin/);
  });

  it('tells the agent to open the panel when no client is listening', () => {
    const r = handleCreateLocalComments(() => 0, { comments: [{ comment: 'fix it' }] });
    expect(r.content[0].text).toMatch(/no Yocoolab panel is listening|open the Yocoolab panel/i);
  });

  it('refuses an empty set', () => {
    const r = handleCreateLocalComments(() => 1, { comments: [{ comment: '  ' }] });
    expect(r.content[0].text).toMatch(/No valid comments/);
  });
});
