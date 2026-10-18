/**
 * Feature flags for reversible behaviour changes.
 *
 * PROJECT_PR_LINKS — lets an agent working a LINK-ONLY project (workspace key
 * "project:<uuid>", no GitHub App access) record its own PR / preview links on
 * the thread via `mark_thread_addressed`, and stops steering such agents into
 * the GitHub-only `create_pr_for_thread` tool. Default ON; set
 * YOCOOLAB_PROJECT_PR_LINKS=0 in the MCP env block to restore the previous
 * behaviour exactly. Nothing is deleted — every call site keeps its legacy
 * branch under `!PROJECT_PR_LINKS`.
 */
export const PROJECT_PR_LINKS: boolean = process.env.YOCOOLAB_PROJECT_PR_LINKS !== '0';

/**
 * AGENT_BRIEF — get_thread_context returns the backend's agent brief (GET
 * /threads/:id/brief) with the thread's screenshots, mark_thread_addressed
 * reports in one call (POST /threads/:id/addressed), and list_open_threads
 * prints a Repository line (and the lane) instead of the raw repo key. The
 * first two fall back to the previous behaviour on their own when the backend
 * answers 404 (older backend, or the brief turned off with BRIEF_ENABLED=0).
 * Default ON; set YOCOOLAB_AGENT_BRIEF=0 in the MCP env block to always take
 * the previous path. YOCOOLAB_PROJECT_PR_LINKS=0 still restores the pre-2.5
 * mark_thread_addressed exactly, whatever this flag says.
 */
export const AGENT_BRIEF: boolean = process.env.YOCOOLAB_AGENT_BRIEF !== '0';

/** "owner/name" = a GitHub-App-connected repo key; anything else (e.g. "project:<uuid>") is link-only. */
export const OWNER_NAME_KEY = /^[^/]+\/[^/]+$/;

export function isOwnerNameKey(repoKey: string | null | undefined): boolean {
  return typeof repoKey === 'string' && OWNER_NAME_KEY.test(repoKey);
}
