import type { ActivityEvent, SessionSummary } from './activity-types.js';

export class SessionManager {
  private sessions = new Map<string, SessionSummary>();

  processEvent(event: ActivityEvent): SessionSummary {
    let session = this.sessions.get(event.session_id);

    if (!session) {
      session = {
        session_id: event.session_id,
        started_at: event.timestamp,
        last_event_at: event.timestamp,
        cwd: event.cwd,
        event_count: 0,
        tool_counts: {},
        status: 'active',
        files_touched: [],
      };
      this.sessions.set(event.session_id, session);
    }

    session.last_event_at = event.timestamp;
    session.event_count++;

    if (event.tool_name) {
      session.tool_counts[event.tool_name] =
        (session.tool_counts[event.tool_name] || 0) + 1;
    }

    // Track files touched
    const filePath = extractFilePath(event);
    if (filePath && !session.files_touched.includes(filePath)) {
      session.files_touched.push(filePath);
    }

    if (event.hook_event_name === 'SessionEnd') {
      session.status = 'ended';
    }

    return { ...session };
  }

  getSession(sessionId: string): SessionSummary | undefined {
    return this.sessions.get(sessionId);
  }

  getAllSessions(): SessionSummary[] {
    return Array.from(this.sessions.values()).sort(
      (a, b) => b.last_event_at - a.last_event_at
    );
  }
}

function extractFilePath(event: ActivityEvent): string | undefined {
  if (!event.tool_input) return undefined;
  const input = event.tool_input as Record<string, unknown>;
  if (typeof input.file_path === 'string') return input.file_path;
  if (typeof input.path === 'string') return input.path;
  return undefined;
}
