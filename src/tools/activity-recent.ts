import type { ActivityEventStore } from '../event-store.js';

export function handleGetRecentEvents(
  eventStore: ActivityEventStore,
  limit: number = 10,
) {
  const clamped = Math.max(1, Math.min(limit, 50));
  const events = eventStore.recent(clamped);

  if (events.length === 0) {
    return {
      content: [{ type: 'text' as const, text: 'No recent activity events.' }],
    };
  }

  const lines: string[] = [`# Last ${events.length} Events`, ''];

  for (const ev of events) {
    const ts = new Date(ev.timestamp).toLocaleTimeString();
    const hookName = ev.hook_event_name;
    const toolName = ev.tool_name || '';

    let detail = '';
    if (hookName === 'UserPromptSubmit') {
      const p = ev.prompt || '';
      detail = p.length > 80 ? p.slice(0, 80) + '...' : p;
    } else if (toolName === 'Bash') {
      const cmd = (ev.tool_input as Record<string, unknown>)?.command || '';
      detail = String(cmd).length > 60 ? String(cmd).slice(0, 60) + '...' : String(cmd);
    } else if (toolName === 'Read' || toolName === 'Write' || toolName === 'Edit') {
      detail = String((ev.tool_input as Record<string, unknown>)?.file_path || '');
    } else if (toolName === 'Glob' || toolName === 'Grep') {
      detail = String((ev.tool_input as Record<string, unknown>)?.pattern || '');
    } else if (toolName === 'Task') {
      detail = String((ev.tool_input as Record<string, unknown>)?.description || '');
    } else if (ev.error) {
      detail = ev.error.slice(0, 80);
    }

    const prefix = toolName ? `${hookName}:${toolName}` : hookName;
    lines.push(`- **${ts}** \`${prefix}\` ${detail}`);
  }

  return {
    content: [{ type: 'text' as const, text: lines.join('\n') }],
  };
}
