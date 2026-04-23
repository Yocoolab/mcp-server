import type { ActivityEventStore } from '../event-store.js';
import type { SessionManager } from '../session-manager.js';

export function handleGetActivitySummary(
  eventStore: ActivityEventStore,
  sessionManager: SessionManager,
) {
  const events = eventStore.recent(eventStore.count());
  const sessions = sessionManager.getAllSessions();
  const activeSessions = sessions.filter((s) => s.status === 'active');

  // Aggregate tool counts across all sessions
  const toolTotals: Record<string, number> = {};
  for (const s of sessions) {
    for (const [tool, count] of Object.entries(s.tool_counts)) {
      toolTotals[tool] = (toolTotals[tool] || 0) + count;
    }
  }

  // Collect all files touched
  const allFiles = new Set<string>();
  for (const s of sessions) {
    for (const f of s.files_touched) {
      allFiles.add(f);
    }
  }

  // Count errors
  const errorCount = events.filter(
    (e) => e.hook_event_name === 'PostToolUseFailure',
  ).length;

  // Format tool breakdown
  const toolBreakdown = Object.entries(toolTotals)
    .sort((a, b) => b[1] - a[1])
    .map(([tool, count]) => `  ${tool}: ${count}`)
    .join('\n');

  const text = [
    '# Activity Summary',
    '',
    `**Total events:** ${events.length}`,
    `**Active sessions:** ${activeSessions.length}`,
    `**Total sessions:** ${sessions.length}`,
    `**Files touched:** ${allFiles.size}`,
    `**Errors:** ${errorCount}`,
    '',
    '## Tool Usage',
    toolBreakdown || '  No tool usage recorded',
    '',
    '## Active Sessions',
    ...activeSessions.map((s) => {
      const dur = Math.round((Date.now() - s.started_at) / 1000 / 60);
      return `  - ${s.session_id.slice(0, 8)}... (${dur}m, ${s.event_count} events, ${s.files_touched.length} files)`;
    }),
  ].join('\n');

  return {
    content: [{ type: 'text' as const, text }],
  };
}
