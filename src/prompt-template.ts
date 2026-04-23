import type { ClaudePromptContext } from './types.js';

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

  if (threadContext) {
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
