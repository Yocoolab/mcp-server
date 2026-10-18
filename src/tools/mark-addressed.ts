import { YocoolabApiClient } from '../api-client.js';
import type { AddressedResult, ThreadDetail } from '../api-client.js';
import type { ThreadUpdateEmitter } from '../http-bridge.js';
import { AGENT_BRIEF, PROJECT_PR_LINKS, isOwnerNameKey } from '../feature-flags.js';

export interface MarkAddressedArgs {
  thread_id: string;
  message?: string;
  /** PR the agent opened itself (link-only projects open PRs with their own git/gh). */
  pr_url?: string;
  pr_branch?: string;
  /** Deployed preview of the change. Threads have no preview column — it goes into the review message. */
  preview_url?: string;
}

/**
 * Derive the PR / MR number from a PR URL. Supports GitHub (/pull/N) and
 * GitLab (/merge_requests/N). Returns null when no number can be read.
 */
export function derivePrNumber(prUrl: string): number | null {
  const m = prUrl.match(/\/pull\/(\d+)(?:[/?#]|$)/) || prUrl.match(/\/merge_requests\/(\d+)(?:[/?#]|$)/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) ? n : null;
}

function cleanUrl(v: string | undefined): string | null {
  const s = (v || '').trim();
  return s ? s : null;
}

/**
 * The GitHub Pages pr-preview address — ONLY for GitHub-App-connected
 * "owner/name" repos, from the PR the agent hands over or the one already on
 * the thread.
 */
function derivedPreviewUrl(thread: Pick<ThreadDetail, 'repo' | 'pr_number'>, prUrl: string | null): string | null {
  if (!isOwnerNameKey(thread.repo)) return null;
  const prNumber = (prUrl ? derivePrNumber(prUrl) : null) ?? thread.pr_number ?? null;
  if (!prNumber) return null;
  const [owner, repo] = thread.repo.split('/');
  return `https://${owner.toLowerCase()}.github.io/${repo}/pr-preview/pr-${prNumber}/`;
}

export async function handleMarkAddressed(
  api: YocoolabApiClient,
  args: MarkAddressedArgs,
  emitThreadUpdate?: ThreadUpdateEmitter
) {
  if (!PROJECT_PR_LINKS) {
    return handleMarkAddressedLegacy(api, args, emitThreadUpdate);
  }

  // The preview: what the agent tells us, else the pr-preview convention,
  // which needs the thread's key and PR number — the only reason to read the
  // thread before reporting.
  let thread: ThreadDetail | null = null;
  let previewUrl = cleanUrl(args.preview_url);
  if (!previewUrl) {
    thread = await api.getThread(args.thread_id);
    previewUrl = derivedPreviewUrl(thread, cleanUrl(args.pr_url));
  }

  // One call: the backend moves the stage, records the links it accepts,
  // posts the reply and notifies (POST /threads/:id/addressed). A backend from
  // before that route answers 404 → the step-by-step path below.
  if (AGENT_BRIEF) {
    const result = await api.addressThread(args.thread_id, {
      message: args.message,
      pr_url: cleanUrl(args.pr_url),
      pr_branch: cleanUrl(args.pr_branch),
      preview_url: previewUrl,
    });
    if (result) return reportAddressed(args, result, previewUrl, emitThreadUpdate);
  }

  return markAddressedStepwise(api, args, thread ?? await api.getThread(args.thread_id), emitThreadUpdate);
}

/** The tool result (and the extension's live update) for a POST /addressed answer. */
function reportAddressed(
  args: MarkAddressedArgs,
  result: AddressedResult,
  previewUrl: string | null,
  emitThreadUpdate?: ThreadUpdateEmitter
) {
  const recorded = result.recorded || { pr_url: null, pr_number: null, pr_branch: null, preview_url: null };
  const rejected = Array.isArray(result.rejected) ? result.rejected : [];
  const posted = result.message?.content || '';
  const explicitPreview = cleanUrl(args.preview_url);

  // Push SSE event so the extension flips to the "In review" state. The
  // backend also tells the dashboard and the extension panels itself.
  if (emitThreadUpdate) {
    emitThreadUpdate(args.thread_id, 'thread_in_review', {
      status: result.thread?.status || 'open',
      kanban_stage: 'in_review',
      message: posted || null,
      pr_url: result.thread?.pr_url ?? null,
      pr_number: result.thread?.pr_number ?? null,
      pr_branch: result.thread?.pr_branch ?? null,
      preview_url: recorded.preview_url ?? null,
    });
  }

  const links: string[] = [];
  if (recorded.pr_url) links.push(`PR ${recorded.pr_url}${recorded.pr_number != null ? ` (#${recorded.pr_number})` : ''}`);
  if (recorded.pr_branch) links.push(`branch ${recorded.pr_branch}`);
  if (explicitPreview && recorded.preview_url) links.push(`preview ${recorded.preview_url}`);
  const refused = rejected.map((r) => `${r.field} (${r.error})`);

  return {
    content: [
      {
        type: 'text' as const,
        text: [
          `Thread ${args.thread_id} moved to In Review — it is ready for a human to verify and close. It was NOT auto-resolved (only a person closes a thread).`,
          links.length ? `Links recorded on the thread: ${links.join(', ')}.` : '',
          refused.length ? `Not recorded: ${refused.join(', ')}. The thread still moved to In Review and the reply went out; put the right link in a follow-up message if it matters.` : '',
          posted ? `Message added: "${posted}"` : '',
          previewUrl && !explicitPreview && recorded.preview_url ? `Preview: ${recorded.preview_url}` : '',
        ].filter(Boolean).join(' '),
      },
    ],
  };
}

/**
 * The step-by-step report for a backend without POST /threads/:id/addressed:
 * the stage PATCH, the links PATCH, the review message and the notification.
 */
async function markAddressedStepwise(
  api: YocoolabApiClient,
  args: MarkAddressedArgs,
  thread: ThreadDetail,
  emitThreadUpdate?: ThreadUpdateEmitter
) {
  // PR links the agent is recording now (link-only projects: the agent opened
  // the PR with its own git/gh and hands us the URL).
  const prUrl = cleanUrl(args.pr_url);
  const prBranch = cleanUrl(args.pr_branch);
  const prNumber = prUrl ? derivePrNumber(prUrl) : null;
  const effectivePrNumber = prNumber ?? thread.pr_number ?? null;

  // Preview: prefer what the agent tells us; fall back to the GitHub Pages
  // pr-preview convention ONLY for GitHub-App-connected "owner/name" repos.
  const previewUrl: string | null = cleanUrl(args.preview_url) ?? derivedPreviewUrl(thread, prUrl);

  const linksRecorded = Boolean(prUrl || cleanUrl(args.preview_url));

  // Build the review message. When the agent recorded links, always post a
  // message (the preview has no column of its own — the message is where the
  // reviewer finds it). Otherwise keep the legacy "message only if given".
  let finalMessage = args.message || '';
  if (linksRecorded && !finalMessage) {
    finalMessage = 'A change is ready for your review.';
  }
  if (prUrl && finalMessage && !finalMessage.includes(prUrl)) {
    finalMessage += `\n\nPR: ${prUrl}`;
  }
  if (previewUrl && finalMessage && !finalMessage.includes(previewUrl)) {
    finalMessage += `\n\nPreview: ${previewUrl}`;
  }

  // 1. Move the thread to the "In Review" column and clear the pending flag —
  //    but do NOT resolve it. Closing a thread is a human decision; the agent's
  //    job ends at "ready for review". This is the one thing the tool must
  //    always do, so it goes first, with the legacy body.
  await api.updateThread(args.thread_id, thread.repo, {
    kanban_stage: 'in_review',
    claude_code_pending: false,
  });

  // 2. Record the links the agent handed us in a SEPARATE patch: the backend
  //    validates pr_url as a URL, and a rejected link must never undo the stage
  //    move or stop the review message.
  const linkUpdates: Record<string, unknown> = {};
  if (prUrl) linkUpdates.pr_url = prUrl;
  if (prNumber !== null) linkUpdates.pr_number = prNumber;
  if (prBranch) linkUpdates.pr_branch = prBranch;
  let linksSaved = false;
  let linkError: string | null = null;
  if (Object.keys(linkUpdates).length) {
    try {
      await api.updateThread(args.thread_id, thread.repo, linkUpdates);
      linksSaved = true;
    } catch (err) {
      linkError = err instanceof Error ? err.message : String(err);
      console.error('[mark-addressed] Failed to record PR links on the thread:', err);
    }
  }

  // 3. The review message (the preview has no column of its own — this is
  //    where the reviewer finds it).
  if (finalMessage) {
    await api.addMessage(args.thread_id, finalMessage, thread.repo);
  }

  // 4. Notify thread participants that a change is ready for their review.
  //    Only a PR the agent supplied in THIS call travels along — the backend
  //    already announced any PR attached earlier, so re-sending thread.pr_url
  //    would post "PR created" a second time.
  const notifyPrUrl = linksSaved && prUrl ? prUrl : undefined;
  try {
    const notifyResult = await api.notifyParticipants(
      args.thread_id,
      thread.repo,
      'pr_created',
      finalMessage || 'A change is ready for your review.',
      notifyPrUrl,
    );
    console.error(`[mark-addressed] Notified ${notifyResult.notified} participant(s)`);
  } catch (err) {
    console.error('[mark-addressed] Failed to notify participants:', err);
  }

  // Push SSE event so the extension flips to the "In review" state.
  if (emitThreadUpdate) {
    emitThreadUpdate(args.thread_id, 'thread_in_review', {
      status: 'open',
      kanban_stage: 'in_review',
      message: finalMessage || null,
      pr_url: (linksSaved ? prUrl : null) ?? thread.pr_url ?? null,
      pr_number: linksSaved ? effectivePrNumber : (thread.pr_number ?? null),
      pr_branch: (linksSaved ? prBranch : null) ?? thread.pr_branch ?? null,
      preview_url: previewUrl,
    });
  }

  const recorded: string[] = [];
  if (linksSaved && prUrl) recorded.push(`PR ${prUrl}${prNumber !== null ? ` (#${prNumber})` : ''}`);
  if (linksSaved && prBranch) recorded.push(`branch ${prBranch}`);
  if (cleanUrl(args.preview_url)) recorded.push(`preview ${previewUrl}`);

  return {
    content: [
      {
        type: 'text' as const,
        text: [
          `Thread ${args.thread_id} moved to In Review — it is ready for a human to verify and close. It was NOT auto-resolved (only a person closes a thread).`,
          recorded.length ? `Links recorded on the thread: ${recorded.join(', ')}.` : '',
          linkError ? `The thread was moved to In Review, but the PR link could not be recorded on it (${linkError}); the link is still in the review message.` : '',
          finalMessage ? `Message added: "${finalMessage}"` : '',
          previewUrl && !cleanUrl(args.preview_url) ? `Preview: ${previewUrl}` : '',
        ].filter(Boolean).join(' '),
      },
    ],
  };
}

/**
 * Pre-PROJECT_PR_LINKS behaviour, kept verbatim so the flag is a true revert.
 */
async function handleMarkAddressedLegacy(
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
