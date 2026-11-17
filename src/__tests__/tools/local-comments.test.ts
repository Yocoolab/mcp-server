import { describe, it, expect } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { LocalCommentStore } from '../../local-comment-store.js';
import { handleListLocalThreads, handleGetLocalComments, handleCreateLocalComments } from '../../tools/local-comments.js';

let n = 0;
/** A store backed by a unique temp file, so tests never share the real shared file. */
function freshStore(): LocalCommentStore {
  const f = path.join(os.tmpdir(), `yc-tools-test-${process.pid}-${Date.now()}-${n++}.json`);
  try { fs.rmSync(f, { force: true }); } catch { /* ignore */ }
  return new LocalCommentStore(f);
}

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
    const r = handleListLocalThreads(freshStore(), {});
    expect(r.content[0].text).toMatch(/no account|without an account|No local comments/i);
  });

  it('lists open threads with element, selector and page', () => {
    const s = freshStore();
    s.set('https://shop.com', { threads: [thread('t1')] });
    const r = handleListLocalThreads(s, {});
    expect(r.content[0].text).toContain('t1');
    expect(r.content[0].text).toContain('button#t1');
    expect(r.content[0].text).toContain('Buy now');
    expect(r.content[0].text).toContain('https://shop.com');
  });

  it('hides resolved threads unless include_resolved is set', () => {
    const s = freshStore();
    s.set('https://shop.com', { threads: [thread('open1'), thread('done1', { status: 'resolved' })] });
    expect(handleListLocalThreads(s, {}).content[0].text).not.toContain('done1');
    expect(handleListLocalThreads(s, { include_resolved: true }).content[0].text).toContain('done1');
  });

  it('filters by origin', () => {
    const s = freshStore();
    s.set('https://a.com', { threads: [thread('a1')] });
    s.set('https://b.com', { threads: [thread('b1')] });
    const r = handleListLocalThreads(s, { origin: 'https://b.com' });
    expect(r.content[0].text).toContain('b1');
    expect(r.content[0].text).not.toContain('a1');
  });

  it('marks threads handed off to an agent as pending, and pending_only filters to them', () => {
    const s = freshStore();
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
    const s = freshStore();
    s.set('https://shop.com', { threads: [thread('idle1')] });
    expect(handleListLocalThreads(s, { pending_only: true }).content[0].text).toMatch(/Agent Build It|pending/i);
  });
});

describe('get_local_comments', () => {
  it('returns full detail (xpath, context, conversation) for a thread id', () => {
    const s = freshStore();
    s.set('https://shop.com', { threads: [thread('t1', { messages: [{ content: 'make it green', author_name: 'You' }, { content: 'and bigger', author_name: 'You' }] })] });
    const r = handleGetLocalComments(s, { thread_id: 't1' });
    expect(r.content[0].text).toContain('//button[@id="t1"]');
    expect(r.content[0].text).toContain('element context');
    expect(r.content[0].text).toContain('and bigger');
  });

  it('falls back to all open threads on the most-recent page', () => {
    const s = freshStore();
    s.set('https://shop.com', { threads: [thread('t1'), thread('t2')] });
    const r = handleGetLocalComments(s, {});
    expect(r.content[0].text).toContain('2 open local comment');
    expect(r.content[0].text).toContain('t1');
    expect(r.content[0].text).toContain('t2');
  });

  it('reports a clear miss for an unknown thread id', () => {
    const r = handleGetLocalComments(freshStore(), { thread_id: 'nope' });
    expect(r.content[0].text).toContain('nope');
  });
});

describe('create_local_comments', () => {
  it('maps items and queues them for the bridge owner to deliver', () => {
    const store = freshStore();
    const r = handleCreateLocalComments(store, { comments: [
      { comment: 'Make the CTA green', page_url: 'https://acme.app/', selector: '.cta', priority: 'high' },
      { comment: '   ', page_url: 'https://acme.app/' }, // dropped
    ] });
    expect(r.content[0].text).toMatch(/Queued 1 pin/);
    // the bridge owner drains the same (file-backed) queue
    const drained = store.drainCreates();
    expect(drained).toHaveLength(1);
    expect(drained[0]).toMatchObject({ message: 'Make the CTA green', selector: '.cta', priority: 'high', page_url: 'https://acme.app/' });
    // draining is one-shot
    expect(store.drainCreates()).toHaveLength(0);
  });

  it('a different process (store on the same file) drains what was queued', () => {
    const f = require('node:path').join(require('node:os').tmpdir(), `yc-q-${process.pid}-${Date.now()}.json`);
    const agentSide = new LocalCommentStore(f);
    const bridgeSide = new LocalCommentStore(f);
    handleCreateLocalComments(agentSide, { comments: [{ comment: 'fix spacing', page_url: 'https://a.com/' }] });
    expect(bridgeSide.drainCreates()).toHaveLength(1);
  });

  it('refuses an empty set', () => {
    const r = handleCreateLocalComments(freshStore(), { comments: [{ comment: '  ' }] });
    expect(r.content[0].text).toMatch(/No valid comments/);
  });
});
