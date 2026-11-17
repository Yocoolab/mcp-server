import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { LocalCommentStore } from '../local-comment-store.js';

/**
 * No-account ("local") comment tools. These need NO Yocoolab token: the
 * person's signed-out comments live in the extension and are pushed to the
 * bridge, so the agent can read them the same way it reads the selection.
 * This is the MCP counterpart to the "Copy for your agent" button — same
 * comments, handed over directly instead of pasted.
 */

function str(v: unknown): string {
  return v == null ? '' : String(v);
}

/** Like str, but JSON-encodes objects/arrays so context fields don't render as
 *  "[object Object]" — the agent needs the actual element/view context. */
function ctxStr(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'object') { try { return JSON.stringify(v); } catch { return ''; } }
  return String(v);
}

/** One thread rendered as a readable block for the agent. */
function renderThread(origin: string, t: Record<string, unknown>, opts: { full: boolean }): string {
  const lines: string[] = [];
  const first = str(t.first_message || t.first_message_content);
  const pending = t.claude_code_pending === true || t.claude_code_pending === 'true';
  const agent = str(t.target_agent_type);
  const pendingMark = pending ? ` · pending for ${agent || 'an agent'}` : '';
  lines.push(`**Thread ${str(t.id)}** — ${str(t.status) || 'open'}${t.priority && t.priority !== 'normal' ? ` · ${str(t.priority)}` : ''}${pendingMark}`);
  if (first) lines.push(`  “${first}”`);

  // Where on the page — enough for the agent to find the source.
  const tag = str(t.element_tag);
  const elText = str(t.element_text);
  if (tag || elText) lines.push(`  element: <${tag || '?'}>${elText ? ` “${elText.slice(0, 60)}”` : ''}`);
  const selector = str(t.selector);
  if (selector) lines.push(`  selector: ${selector}`);
  const xpath = str(t.xpath);
  if (opts.full && xpath) lines.push(`  xpath: ${xpath}`);
  const page = str(t.page_url);
  if (page) lines.push(`  page: ${page}`);
  else lines.push(`  page origin: ${origin}`);

  if (opts.full) {
    const ctx = ctxStr(t.element_context);
    if (ctx) lines.push(`  element context: ${ctx.slice(0, 600)}`);
    const view = ctxStr(t.view_context);
    if (view) lines.push(`  view context: ${view.slice(0, 400)}`);
    const msgs = Array.isArray(t.messages) ? (t.messages as Array<Record<string, unknown>>) : [];
    if (msgs.length > 1) {
      lines.push(`  conversation:`);
      for (const m of msgs) lines.push(`    - ${str(m.author_name) || 'You'}: ${str(m.content)}`);
    }
  } else {
    const n = Number(t.message_count) || (Array.isArray(t.messages) ? (t.messages as unknown[]).length : 0);
    if (n > 1) lines.push(`  (${n} messages — get_local_comments for the full thread)`);
  }
  return lines.join('\n');
}

type ToolResult = { content: Array<{ type: 'text'; text: string }> };

const isPending = (t: Record<string, unknown>): boolean => t.claude_code_pending === true || t.claude_code_pending === 'true';

/** list_local_threads — summary of the person's no-account comments. */
export function handleListLocalThreads(store: LocalCommentStore, args: { origin?: string; include_resolved?: boolean; pending_only?: boolean }): ToolResult {
  let rows = store.allThreads();
  if (args.origin) rows = rows.filter((r) => r.origin === args.origin);
  if (!args.include_resolved) rows = rows.filter((r) => str(r.thread.status) !== 'resolved');
  if (args.pending_only) rows = rows.filter((r) => isPending(r.thread));

  if (rows.length === 0) {
    return {
      content: [{
        type: 'text' as const,
        text: args.pending_only
          ? 'Nothing is pending for an agent right now. The person hands a comment off with "Agent Build It" in the panel; it then shows here as pending.'
          : store.count() === 0
            ? 'No local comments yet. The person can leave feedback without an account: click the Yocoolab icon on any page, then click an element and type a comment — it appears here with no sign-in.'
            : 'No matching open local threads. Pass include_resolved: true to see resolved ones, or drop the origin filter.',
      }],
    };
  }

  const byOrigin = new Map<string, typeof rows>();
  for (const r of rows) {
    const list = byOrigin.get(r.origin) || [];
    list.push(r);
    byOrigin.set(r.origin, list);
  }
  const blocks: string[] = [`${rows.length} local (no-account) comment thread(s). These live in the person's browser; nothing was sent to a server.`];
  for (const [origin, list] of byOrigin) {
    blocks.push(`\n### ${origin}`);
    list.forEach((r) => blocks.push(renderThread(origin, r.thread, { full: false })));
  }
  return { content: [{ type: 'text' as const, text: blocks.join('\n') }] };
}

/** get_local_comments — full detail of one thread, or all open on the current page. */
export function handleGetLocalComments(store: LocalCommentStore, args: { thread_id?: string }): ToolResult {
  if (args.thread_id) {
    const hit = store.findThread(args.thread_id);
    if (!hit) {
      return { content: [{ type: 'text' as const, text: `No local thread ${args.thread_id}. Use list_local_threads to see the current ones.` }] };
    }
    return { content: [{ type: 'text' as const, text: renderThread(hit.origin, hit.thread, { full: true }) }] };
  }

  const snap = store.latest();
  if (!snap) {
    return { content: [{ type: 'text' as const, text: 'No local comments yet. Click the Yocoolab icon on any page, then click an element and comment — no account needed.' }] };
  }
  const open = snap.threads.filter((t) => str(t.status) !== 'resolved');
  if (open.length === 0) {
    return { content: [{ type: 'text' as const, text: `No open local comments on ${snap.origin} (all resolved).` }] };
  }
  const blocks = [`${open.length} open local comment(s) on ${snap.origin}:`];
  open.forEach((t) => blocks.push('\n' + renderThread(snap.origin, t, { full: true })));
  return { content: [{ type: 'text' as const, text: blocks.join('\n') }] };
}

/**
 * create_local_comments — the agent creates no-account pins in the person's
 * browser (e.g. from a meeting transcript). Sent to the extension over the
 * bridge's SSE channel; the extension writes them into its own local store.
 * Nothing touches a server. `emit` returns how many extension clients received.
 */
type CreateArgs = { comments: Array<{ comment: string; page_url?: string; selector?: string; element_tag?: string; element_text?: string; priority?: string }> };

/** create_local_comments handler — maps items and pushes them to the extension. */
export function handleCreateLocalComments(emit: (items: Array<Record<string, unknown>>) => number, args: CreateArgs): ToolResult {
  const items = (args.comments || [])
    .filter((c) => c && c.comment && c.comment.trim())
    .map((c) => ({
      message: c.comment.trim(),
      page_url: c.page_url || null,
      selector: c.selector || null,
      element_tag: c.element_tag || null,
      element_text: c.element_text || null,
      priority: c.priority === 'low' || c.priority === 'high' ? c.priority : 'normal',
      tags: ['from-meeting'],
      source: 'agent',
    }));
  if (items.length === 0) {
    return { content: [{ type: 'text' as const, text: 'No valid comments to create — each needs a non-empty comment.' }] };
  }
  const clients = emit(items);
  return {
    content: [{
      type: 'text' as const,
      text: clients > 0
        ? `Sent ${items.length} pin(s) to the person's browser — they appear in the Yocoolab panel on the matching page${items.some((i) => !i.page_url) ? ' (items without a page_url land on whichever page they have open)' : ''}.`
        : `Prepared ${items.length} pin(s), but no Yocoolab panel is listening. Ask the person to open the Yocoolab panel on the page (click the extension icon), then run this again.`,
    }],
  };
}

export function registerCreateLocalComment(server: McpServer, emit: (items: Array<Record<string, unknown>>) => number): void {
  server.tool(
    'create_local_comments',
    'Create no-account ("local") Yocoolab pins in the person\'s browser — for example, turning a meeting transcript into pinned feedback. No Yocoolab token or account: the pins are written to the person\'s own browser over the local bridge, nothing is sent to a server. Give each item the page it belongs on and a clear comment; add a CSS selector when you can infer one so the pin lands on the element. The person must have the Yocoolab panel open on that page to receive them.',
    {
      comments: z.array(z.object({
        comment: z.string().describe('The feedback as actionable text.'),
        page_url: z.string().optional().describe('Full URL of the page this pin belongs on. Required for the pin to land on the right site.'),
        selector: z.string().optional().describe('CSS selector for the element, when you can infer one.'),
        element_tag: z.string().optional().describe('Element tag, e.g. "BUTTON".'),
        element_text: z.string().optional().describe('Visible text of the element, to help locate it.'),
        priority: z.enum(['low', 'normal', 'high']).optional(),
      })).describe('The pins to create.'),
    },
    async (args: CreateArgs) => handleCreateLocalComments(emit, args)
  );
}

export function registerLocalCommentTools(server: McpServer, store: LocalCommentStore): void {
  server.tool(
    'list_local_threads',
    'Lists the person\'s no-account ("local") Yocoolab comments — visual feedback they left on a page without signing in, pushed from the Chrome extension over the local bridge. No Yocoolab token needed. Each thread carries the element (tag, selector, xpath), the comment text, and the page URL, so you can locate the code it refers to. Threads the person handed off with "Agent Build It" are marked "pending for <agent>" — use pending_only: true for just your to-do list. This is the same feedback as the "Copy for your agent" button, handed to you directly. Use get_local_comments for a thread\'s full detail.',
    {
      origin: z.string().optional().describe('Only threads from this page origin (e.g. "https://example.com"). Omit for every origin.'),
      include_resolved: z.boolean().optional().describe('Include resolved/done threads too. Default: only open ones.'),
      pending_only: z.boolean().optional().describe('Only threads the person explicitly handed off to an agent ("Agent Build It") — your to-do list.'),
    },
    async (args: { origin?: string; include_resolved?: boolean; pending_only?: boolean }) => handleListLocalThreads(store, args)
  );

  server.tool(
    'get_local_comments',
    'Returns the full detail of no-account ("local") Yocoolab comments — all messages, the element context, selector and xpath — so you can make the change the person asked for. No Yocoolab token needed. Pass thread_id for one thread; omit it to get every open thread on the page the person is currently working on (the most recently updated origin).',
    {
      thread_id: z.string().optional().describe('A specific local thread id (from list_local_threads). Omit for all open threads on the current page.'),
    },
    async (args: { thread_id?: string }) => handleGetLocalComments(store, args)
  );
}
