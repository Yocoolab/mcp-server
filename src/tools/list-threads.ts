import { YocoolabApiClient } from '../api-client.js';
import type { ThreadSummary } from '../api-client.js';
import { AGENT_BRIEF, PROJECT_PR_LINKS, isOwnerNameKey } from '../feature-flags.js';
import { elementTextLine, isFormControlTag, laneName, pageAddress, repositoryLabel } from '../thread-text.js';

/**
 * Which repository a thread belongs in, as far as the list can say. The API's
 * own label when it gives one; else an "owner/name" key IS the repository (a
 * GitHub-App-connected one); else the key is a link-only project's internal
 * id ("project:<uuid>"), which names no codebase — get_thread_context does.
 */
function repositoryLine(t: ThreadSummary): string {
  const label = repositoryLabel(t.repository);
  if (label) return label;
  if (isOwnerNameKey(t.repo)) {
    return `${t.repo}${t.branch ? ` (branch: ${t.branch})` : ''} — connected through Yocoolab's GitHub App (create_pr_for_thread works)`;
  }
  return 'link-only project — get_thread_context names the repository (linked, inferred from the page URL, or not linked yet)';
}

export async function handleListThreads(
  api: YocoolabApiClient,
  args: { repo?: string; branch?: string; claude_code_pending?: boolean }
) {
  // Per-agent routing (paired with backend migration 041 and the
  // extension's send-to-claude POST body): when a user picks a
  // specific agent in the extension picker, the backend stamps
  // target_agent_type on the thread. Each MCP server process
  // announces its own type via YOCOOLAB_AGENT_TYPE (set by the
  // setup wizard or the user's MCP config). When listing threads
  // pending Claude Code, we filter by that so each agent only sees
  // threads addressed to it (or untargeted threads, which fall back
  // to all). We don't apply the filter for the broader list
  // (claude_code_pending=false/undefined) so general thread queries
  // still return everything.
  const targetAgentType = args.claude_code_pending
    ? (process.env.YOCOOLAB_AGENT_TYPE || undefined)
    : undefined;

  // repo omitted → the backend returns the caller's permission-scoped pool
  // across ALL connected repos. Every thread below is labeled with its repo,
  // change type (service_type) and board stage, so the agent has full context
  // without any hardcoded repo list that goes stale as repos are connected.
  const threads = await api.listThreads(args.repo, {
    status: 'open',
    branch: args.branch,
    claude_code_pending: args.claude_code_pending,
    target_agent_type: targetAgentType,
  });

  if (threads.length === 0) {
    const filters = [
      args.branch ? `on branch ${args.branch}` : '',
      args.claude_code_pending ? '(pending for Claude Code)' : '',
    ].filter(Boolean).join(' ');
    return {
      content: [
        {
          type: 'text' as const,
          text: `No open feedback threads found ${args.repo ? `for ${args.repo}` : 'across your connected repos'}${filters ? ` ${filters}` : ''}.`,
        },
      ],
    };
  }

  const summary = threads.map((t, i) => {
    const parts = [
      `${i + 1}. **Thread ${t.id}**`,
      AGENT_BRIEF
        ? `   Repository: ${repositoryLine(t)}`
        : `   Repo: ${t.repo}${t.branch ? ` (branch: ${t.branch})` : ''}`,
      `   Priority: ${t.priority} | Messages: ${t.message_count} | By: ${t.creator_name}`,
      `   Created: ${t.created_at}`,
    ];
    // Change type + board stage — enough context to route and act:
    // frontend/api/backend/other, and where the card sits on the board — and
    // the project lane (Design/Production/QA) the page belongs to.
    const lane = AGENT_BRIEF ? laneName(t.lane) : null;
    const meta = [
      t.service_type ? `Type: ${t.service_type}` : '',
      t.kanban_stage ? `Stage: ${t.kanban_stage}` : '',
      lane ? `Lane: ${lane}` : '',
    ].filter(Boolean).join(' | ');
    if (meta) parts.push(`   ${meta}`);
    if (t.claude_code_pending) parts.push(`   ⚡ Pending for Claude Code`);
    if (t.selector) parts.push(`   Element: \`${t.selector}\``);
    // A form control's text is what someone typed into it — never printed.
    // Multi-line text stays on the row: line breaks print as ⏎.
    if (t.element_tag) {
      const text = isFormControlTag(t.element_tag) ? '' : elementTextLine(t.element_text);
      parts.push(`   Tag: <${t.element_tag}>${text ? ` "${text}"` : ''}`);
    }
    if (t.page_url) parts.push(`   Page: ${pageAddress(t.page_url)}`);
    if (t.jira_issue_key) parts.push(`   Jira: ${t.jira_issue_key}`);
    if (t.pr_url) parts.push(`   PR: ${t.pr_url}`);
    // Link-only projects: which repository the project points at.
    if (PROJECT_PR_LINKS && Array.isArray(t.repo_links) && t.repo_links.length > 0) {
      const links = t.repo_links
        .filter((l) => l && l.url)
        .map((l) => `${l.role || 'repo'}: ${l.url}`)
        .join(', ');
      if (links) parts.push(`   Repo links: ${links}`);
    }
    if (t.parent_thread_id) {
      parts.push(`   Iteration: ${t.iteration_type} #${t.iteration_number} of thread ${t.parent_thread_id.slice(0, 8)}`);
    }
    return parts.join('\n');
  });

  const scope = args.repo ? `for **${args.repo}**` : 'across all your connected repos';
  return {
    content: [
      {
        type: 'text' as const,
        text: `Found ${threads.length} open thread(s) ${scope}:\n\n${summary.join('\n\n')}`,
      },
    ],
  };
}
