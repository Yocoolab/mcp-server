// ---- Hook event names ----
export type HookEventName =
  | 'SessionStart'
  | 'SessionEnd'
  | 'UserPromptSubmit'
  | 'PreToolUse'
  | 'PostToolUse'
  | 'PostToolUseFailure'
  | 'Stop'
  | 'SubagentStart'
  | 'SubagentStop'
  | 'Notification'
  | 'PreCompact'
  | 'PermissionRequest'
  | 'TeammateIdle'
  | 'TaskCompleted'
  | 'ConfigChange';

// ---- Tool names ----
export type ToolName =
  | 'Bash'
  | 'Read'
  | 'Write'
  | 'Edit'
  | 'Glob'
  | 'Grep'
  | 'WebFetch'
  | 'WebSearch'
  | 'Task'
  | 'TodoWrite'
  | 'AskUserQuestion'
  | 'NotebookEdit'
  | string;

// ---- Tool input schemas ----
export interface BashToolInput {
  command: string;
  description?: string;
  timeout?: number;
  run_in_background?: boolean;
}

export interface WriteToolInput {
  file_path: string;
  content: string;
}

export interface EditToolInput {
  file_path: string;
  old_string: string;
  new_string: string;
  replace_all?: boolean;
}

export interface ReadToolInput {
  file_path: string;
  offset?: number;
  limit?: number;
}

export interface GlobToolInput {
  pattern: string;
  path?: string;
}

export interface GrepToolInput {
  pattern: string;
  path?: string;
  glob?: string;
  output_mode?: 'content' | 'files_with_matches' | 'count';
}

export interface WebFetchToolInput {
  url: string;
  prompt: string;
}

export interface TaskToolInput {
  prompt: string;
  description?: string;
  subagent_type?: string;
}

export type ToolInput =
  | BashToolInput
  | WriteToolInput
  | EditToolInput
  | ReadToolInput
  | GlobToolInput
  | GrepToolInput
  | WebFetchToolInput
  | TaskToolInput
  | Record<string, unknown>;

// ---- Core event shape ----
export interface ActivityEvent {
  id: string;
  timestamp: number;
  session_id: string;
  hook_event_name: HookEventName;
  cwd: string;
  transcript_path: string;

  // Tool-specific
  tool_name?: ToolName;
  tool_input?: ToolInput;
  tool_response?: string;
  tool_use_id?: string;

  // Error info
  error?: string;

  // Session info
  source?: string;

  // Prompt info
  prompt?: string;

  // Subagent info
  agent_id?: string;
  agent_type?: string;

  // Stop info
  stop_hook_active?: boolean;

  // Notification
  message?: string;
  notification_type?: string;

  // Server-enriched
  received_at: number;
}

// ---- Session summary ----
export interface SessionSummary {
  session_id: string;
  started_at: number;
  last_event_at: number;
  cwd: string;
  event_count: number;
  tool_counts: Record<string, number>;
  status: 'active' | 'ended';
  files_touched: string[];
}

// ---- WebSocket messages ----
export type WSMessage =
  | { type: 'event'; data: ActivityEvent }
  | { type: 'snapshot'; data: { events: ActivityEvent[]; sessions: SessionSummary[] } }
  | { type: 'session_update'; data: SessionSummary }
  | { type: 'ping' }
  | { type: 'pong' };

// ---- Raw hook payload from Claude Code stdin ----
export interface RawHookPayload {
  session_id: string;
  hook_event_name: string;
  cwd: string;
  transcript_path: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_response?: string;
  tool_use_id?: string;
  error?: string;
  source?: string;
  prompt?: string;
  agent_id?: string;
  agent_type?: string;
  stop_hook_active?: boolean;
  message?: string;
  notification_type?: string;
  [key: string]: unknown;
}
