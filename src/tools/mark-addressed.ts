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

  // Move the thread to the "In Review" column and clear the pending flag — but do
  // NOT resolve it. Closing a thread is a human decision; the agent's job ends at
  // "ready for review". The person verifies the change and marks it done. This is
  // what keeps the user in control of their own board.
  await api.updateThread(args.thread_id, thread.repo, {
    kanban_stage: 'in_review',
    claude_code_pending: false,
  });

  // Notify thread participants that a change is ready for their review.
  try {
    const notifyResult = await api.notifyParticipants(
      args.thread_id,
      thread.repo,
      'pr_created',
      finalMessage || 'A change is ready for your review.',
    );
    console.error(`[mark-addressed] Notified ${notifyResult.notified} participant(s)`);
  } catch (err) {
    console.error('[mark-addressed] Failed to notify participants:', err);
  }

  // Push SSE event so the extension flips to the "In review" state (thread stays
  // open, action buttons stay live). Older extensions that don't know this event
  // just refetch and read status=open + kanban_stage=in_review.
  if (emitThreadUpdate) {
    emitThreadUpdate(args.thread_id, 'thread_in_review', {
      status: 'open',
      kanban_stage: 'in_review',
      message: finalMessage || null,
      preview_url: previewUrl,
    });
  }

  return {
    content: [
      {
        type: 'text' as const,
        text: [
          `Thread ${args.thread_id} moved to In Review — it is ready for a human to verify and close. It was NOT auto-resolved (only a person closes a thread).`,
          finalMessage ? `Message added: "${finalMessage}"` : '',
          previewUrl ? `Preview: ${previewUrl}` : '',
        ].filter(Boolean).join(' '),
      },
    ],
  };
}
