import type { SessionManager } from '../session-manager.js';

export function handleGetFilesTouched(sessionManager: SessionManager) {
  const sessions = sessionManager.getAllSessions();

  // Collect all files with operation counts
  const fileCounts: Record<string, number> = {};
  for (const s of sessions) {
    for (const f of s.files_touched) {
      fileCounts[f] = (fileCounts[f] || 0) + 1;
    }
  }

  const sorted = Object.entries(fileCounts).sort((a, b) => b[1] - a[1]);

  if (sorted.length === 0) {
    return {
      content: [{ type: 'text' as const, text: 'No files touched yet.' }],
    };
  }

  const lines: string[] = [
    `# Files Touched (${sorted.length} total)`,
    '',
    ...sorted.map(([file, count]) => `- \`${file}\` (${count} session${count > 1 ? 's' : ''})`),
  ];

  return {
    content: [{ type: 'text' as const, text: lines.join('\n') }],
  };
}
