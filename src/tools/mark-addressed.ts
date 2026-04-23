import { YocoolabApiClient } from '../api-client.js';
import type { ThreadUpdateEmitter } from '../http-bridge.js';

export async function handleMarkAddressed(
  api: YocoolabApiClient,
  args: { thread_id: string; message?: string },
  emitThreadUpdate?: ThreadUpdateEmitter
) {
  // Fetch thread to get repo
  const thread = await api.getThread(args.thread_id);

  // Build the preview URL if the thread has a PR
  let previewUrl: string | null = null;
  if (thread.pr_number && thread.repo?.includes('/')) {
    const [owner, repo] = thread.repo.split('/');
    previewUrl = `https://${owner.toLowerCase()}.github.io/${repo}/pr-preview/pr-${thread.pr_number}/`;
  }

  // Append preview URL to message if available and not already included
  let finalMessage = args.message || '';
  if (previewUrl && finalMessage && !finalMessage.includes(previewUrl)) {
    finalMessage += `\n\nPreview: ${previewUrl}`;
  }

  // Add message if provided
  if (finalMessage) {
    await api.addMessage(args.thread_id, finalMessage, thread.repo);
  }

  // Resolve the thread and clear claude_code_pending
  await api.updateThread(args.thread_id, thread.repo, {
    status: 'resolved',
    claude_code_pending: false,
  });

  // Notify thread participants
  try {
    const notifyResult = await api.notifyParticipants(
      args.thread_id,
      thread.repo,
      'resolved',
      finalMessage || 'Thread resolved by Claude Code',
    );
    console.error(`[mark-addressed] Notified ${notifyResult.notified} participant(s)`);
  } catch (err) {
    console.error('[mark-addressed] Failed to notify participants:', err);
  }

  // Push SSE event to extension (include preview URL)
  if (emitThreadUpdate) {
    emitThreadUpdate(args.thread_id, 'thread_resolved', {
      status: 'resolved',
      message: finalMessage || null,
      preview_url: previewUrl,
    });
  }

  return {
    content: [
      {
        type: 'text' as const,
        text: [
          `Thread ${args.thread_id} has been resolved.`,
          finalMessage ? `Message added: "${finalMessage}"` : '',
          previewUrl ? `Preview: ${previewUrl}` : '',
        ].filter(Boolean).join(' '),
      },
    ],
  };
}
