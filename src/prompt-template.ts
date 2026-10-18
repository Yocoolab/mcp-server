import type { ClaudePromptContext } from './types.js';
import { AGENT_BRIEF, PROJECT_PR_LINKS, isOwnerNameKey } from './feature-flags.js';

export function generateClaudePrompt(ctx: ClaudePromptContext): string {
  const { elementPayload, candidates, workspaceRoot, threadContext } = ctx;
  const { element, page, styles } = elementPayload;

  const candidateList = candidates
    .slice(0, 5)
    .map((c, i) => {
      const relPath = c.filePath.replace(workspaceRoot, '').replace(/^\//, '');
      return `${i + 1}) ${relPath} (lines ${c.lineStart}-${c.lineEnd}) confidence=${(c.confidence * 100).toFixed(0)}% reason="${c.reason}"`;
    })
    .join('\n');

  const attrStr = Object.entries(element.attributes)
    .map(([k, v]) => `${k}="${v}"`)
    .join(', ');

  const styleStr = Object.entries(styles.computed)
    .filter(([, v]) => v && v !== 'none' && v !== 'normal' && v !== '0px')
    .slice(0, 10)
    .map(([k, v]) => `${k}: ${v}`)
    .join('; ');

  let prompt = `You are an expert front-end prototyping assistant.

Task:
Make a targeted change to the UI element described below. Do NOT refactor unrelated code. Prefer smallest diff.

Selected element context:
- URL: ${page.url}
- Selector: ${element.selector}
- Tag: <${element.tag.toLowerCase()}>
- Text: "${element.text}"
- ID: ${element.id || '(none)'}
- Classes: ${element.classList.join(', ') || '(none)'}
- Attributes: ${attrStr || '(none)'}
- Computed styles (key): ${styleStr}

Workspace candidates (ranked):
${candidateList || '(no candidates found — search workspace manually)'}`;

  // Include feedback messages from the thread
  if (threadContext && threadContext.messages.length > 0) {
    const feedbackLines = threadContext.messages
      .map((m) => `  ${m.author_name}: "${m.content}"`)
      .join('\n');
    prompt += `\n\nFeedback from the design review thread:\n${feedbackLines}`;
  }

  prompt += `\n\nConstraints:
- Keep existing patterns and style conventions.
- If multiple candidates exist, propose edits for the top candidate only, and explain why.`;

  if (threadContext && PROJECT_PR_LINKS && !isOwnerNameKey(threadContext.repo)) {
    // Link-only project ("project:<uuid>" key): Yocoolab has no GitHub App
    // access, so the agent opens the PR itself and hands the links back via
    // mark_thread_addressed instead of create_pr_for_thread.
    const linkLines = (threadContext.repoLinks || [])
      .filter((l) => l && l.url)
      .map((l) => `  - ${l.role || 'repo'}: ${l.url}`)
      .join('\n');
    prompt += `

## Workflow

Complete all of the following steps in order:

### Step 1: Make the code change
- Read the source file(s) identified above.
- Apply the minimal change that addresses the feedback.
- Verify the change is correct.

### Step 2: Commit, push, and open the Pull Request yourself
- This thread belongs to a link-only project ("${threadContext.repo}"). Yocoolab has no write access to the repository, so do NOT use \`create_pr_for_thread\` — it only works for GitHub-App-connected "owner/name" repos.
- The thread's repo_links tell you which repository/branch the project points at${linkLines ? ':\n' + linkLines : AGENT_BRIEF ? ' (get_thread_context for thread "' + threadContext.threadId + '" names it under Where › Repository, with how to check you are in it)' : ' (see "Repo links" in get_thread_context for thread "' + threadContext.threadId + '")'}. Work in your own checkout of that repository.
- Commit the change on a new branch in your checkout (e.g. "fix/<short-description>") and push it.
- Open the PR with the GitHub CLI (\`gh pr create\`) or your Git host's UI/API. Note the PR URL.
- If your host deploys a preview for the branch (Vercel, Netlify, GitHub Pages, …), note that preview URL too.

### Step 3: Record the links on the thread
- Use the \`mark_thread_addressed\` tool with:
  - thread_id: "${threadContext.threadId}"
  - pr_url: the PR you opened
  - pr_branch: the branch you pushed
  - preview_url: the deployed preview of the change, when you have one
  - message: a short summary of what changed and why
- This moves the thread to "In Review" and records the PR on it; the preview link is posted in the review message. Do NOT resolve the thread — a person closes it after verifying.

### Step 4: Summarize
- Provide a brief summary of what was changed and why.

Now begin with Step 1.`;
  } else if (threadContext) {
    // Full workflow instructions when thread context is available
    prompt += `

## Workflow

Complete all of the following steps in order:

### Step 1: Make the code change
- Read the source file(s) identified above.
- Apply the minimal change that addresses the feedback.
- Verify the change is correct.

### Step 2: Create a Pull Request
- Use the \`create_pr_for_thread\` tool with:
  - thread_id: "${threadContext.threadId}"
  - branch_name: a descriptive branch name (e.g., "fix/<short-description>")
  - title: a clear PR title summarizing the change
  - body: a Markdown description referencing the feedback
  - files: array of {path, content} with the FULL updated file content
- Note the PR URL from the response.

### Step 3: Check for preview deployment
- Wait about 30 seconds, then use the \`get_deployment_preview\` tool with:
  - repo: "${threadContext.repo}"
  - branch: the branch name you used in Step 2
- If no deployment is found yet, wait another 30 seconds and try again (up to 3 attempts).
- If a preview URL is found, proceed to Step 4.
- If no deployment appears after 3 attempts, skip to Step 4 with just the PR URL.

### Step 4: Update the thread
- Use the \`add_thread_message\` tool to post a message to thread "${threadContext.threadId}".
- If a preview URL was found:
  "The fix has been applied and is live for review: [Preview URL]. PR: [PR URL]"
- If no preview URL was found:
  "The fix has been applied. PR: [PR URL]. The preview deployment may still be building."

### Step 5: Summarize
- Provide a brief summary of what was changed and why.

Now begin with Step 1.`;
  } else {
    // Original standalone behavior
    prompt += `
- Output must be a unified diff patch.
- After diff, give a 3-bullet rationale.

Now produce the patch.`;
  }

  return prompt;
}
