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

/** "owner/name" = a GitHub-App-connected repo key; anything else (e.g. "project:<uuid>") is link-only. */
export const OWNER_NAME_KEY = /^[^/]+\/[^/]+$/;

export function isOwnerNameKey(repoKey: string | null | undefined): boolean {
  return typeof repoKey === 'string' && OWNER_NAME_KEY.test(repoKey);
}
