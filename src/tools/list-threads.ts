import { YocoolabApiClient } from '../api-client.js';

export async function handleListThreads(
  api: YocoolabApiClient,
  args: { repo: string; branch?: string; claude_code_pending?: boolean }
) {
  const threads = await api.listThreads(args.repo, {
    status: 'open',
    branch: args.branch,
    claude_code_pending: args.claude_code_pending,
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
          text: `No open feedback threads found for ${args.repo}${filters ? ` ${filters}` : ''}.`,
        },
      ],
    };
  }

  const summary = threads.map((t, i) => {
    const parts = [
      `${i + 1}. **Thread ${t.id}**`,
      `   Priority: ${t.priority} | Messages: ${t.message_count} | By: ${t.creator_name}`,
      `   Created: ${t.created_at}`,
    ];
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

  return {
    content: [
      {
        type: 'text' as const,
        text: `Found ${threads.length} open thread(s) for **${args.repo}**:\n\n${summary.join('\n\n')}`,
      },
    ],
  };
}
