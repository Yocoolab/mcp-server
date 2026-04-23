export const MAX_RING_BUFFER_SIZE = 1000;
export const MAX_TOOL_RESPONSE_SIZE = 50_000; // 50KB truncation limit
export const WS_HEARTBEAT_INTERVAL = 30_000;
export const SNAPSHOT_SIZE = 200;

// Tool accent colors for the dashboard
export const TOOL_COLORS: Record<string, string> = {
  Bash: '#ff6482',
  Read: '#64d2ff',
  Write: '#30d158',
  Edit: '#ff9f0a',
  Glob: '#bf5af2',
  Grep: '#5e5ce6',
  WebFetch: '#ff375f',
  WebSearch: '#ff375f',
  Task: '#ffd60a',
  TodoWrite: '#ac8e68',
  AskUserQuestion: '#0a84ff',
  NotebookEdit: '#5e5ce6',
};

// Event type colors
export const EVENT_COLORS: Record<string, string> = {
  SessionStart: '#0a84ff',
  SessionEnd: '#86868b',
  UserPromptSubmit: '#ac8e68',
  PreToolUse: '#64d2ff',
  PostToolUse: '#30d158',
  PostToolUseFailure: '#ff453a',
  Stop: '#86868b',
  SubagentStart: '#ffd60a',
  SubagentStop: '#ffd60a',
  Notification: '#bf5af2',
};

export const DEFAULT_TOOL_COLOR = '#86868b';
