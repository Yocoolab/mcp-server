import { YocoolabApiClient } from '../api-client.js';

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
      `   Repo: ${t.repo}${t.branch ? ` (branch: ${t.branch})` : ''}`,
      `   Priority: ${t.priority} | Messages: ${t.message_count} | By: ${t.creator_name}`,
      `   Created: ${t.created_at}`,
    ];
    // Change type + board stage — enough context to route and act:
    // frontend/api/backend/other, and where the card sits on the board.
    const meta = [
      t.service_type ? `Type: ${t.service_type}` : '',
      t.kanban_stage ? `Stage: ${t.kanban_stage}` : '',
    ].filter(Boolean).join(' | ');
    if (meta) parts.push(`   ${meta}`);
    if (t.claude_code_pending) parts.push(`   ⚡ Pending for Claude Code`);
    if (t.selector) parts.push(`   Element: \`${t.selector}\``);
    if (t.element_tag) parts.push(`   Tag: <${t.element_tag}>${t.element_text ? ` "${t.element_text}"` : ''}`);
    if (t.page_url) parts.push(`   Page: ${t.page_url}`);
    if (t.jira_issue_key) parts.push(`   Jira: ${t.jira_issue_key}`);
    if (t.pr_url) parts.push(`   PR: ${t.pr_url}`);
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
