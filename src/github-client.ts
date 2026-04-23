/**
 * GitHub API client for creating PRs with atomic multi-file commits.
 * Uses the developer's own GitHub PAT — never touches backend-stored tokens.
 */

export interface FileChange {
  path: string;
  content: string;
}

export interface PrResult {
  pr_number: number;
  pr_url: string;
  branch: string;
}

export interface CommitResult {
  commit_sha: string;
}

export class GitHubClient {
  private token: string;
  private apiBase = 'https://api.github.com';

  constructor(token: string) {
    this.token = token;
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.apiBase}${path}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'Yocoolab-MCP-Server',
        ...options.headers,
      },
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`GitHub API error: ${response.status} ${response.statusText} — ${body}`);
    }

    return response.json() as Promise<T>;
  }

  /**
   * Create a PR with atomic multi-file changes using the Git Trees API.
   *
   * Steps:
   * 1. Get the SHA of the base branch (default: main)
   * 2. Create blobs for each file
   * 3. Create a tree with all file changes
   * 4. Create a commit pointing to the tree
   * 5. Create a new branch ref pointing to the commit
   * 6. Create a pull request
   */
  async createPullRequest(
    owner: string,
    repo: string,
    branchName: string,
    title: string,
    body: string,
    files: FileChange[],
    baseBranch: string = 'main'
  ): Promise<PrResult> {
    // 1. Get the SHA of the base branch
    const baseRef = await this.request<{ object: { sha: string } }>(
      `/repos/${owner}/${repo}/git/ref/heads/${baseBranch}`
    );
    const baseSha = baseRef.object.sha;

    // 2. Get the base commit to find its tree
    const baseCommit = await this.request<{ tree: { sha: string } }>(
      `/repos/${owner}/${repo}/git/commits/${baseSha}`
    );
    const baseTreeSha = baseCommit.tree.sha;

    // 3. Create blobs for each file
    const treeItems: Array<{
      path: string;
      mode: string;
      type: string;
      sha: string;
    }> = [];

    for (const file of files) {
      const blob = await this.request<{ sha: string }>(
        `/repos/${owner}/${repo}/git/blobs`,
        {
          method: 'POST',
          body: JSON.stringify({
            content: file.content,
            encoding: 'utf-8',
          }),
        }
      );

      treeItems.push({
        path: file.path,
        mode: '100644',
        type: 'blob',
        sha: blob.sha,
      });
    }

    // 4. Create a new tree
    const newTree = await this.request<{ sha: string }>(
      `/repos/${owner}/${repo}/git/trees`,
      {
        method: 'POST',
        body: JSON.stringify({
          base_tree: baseTreeSha,
          tree: treeItems,
        }),
      }
    );

    // 5. Create a commit
    const commit = await this.request<{ sha: string }>(
      `/repos/${owner}/${repo}/git/commits`,
      {
        method: 'POST',
        body: JSON.stringify({
          message: title,
          tree: newTree.sha,
          parents: [baseSha],
        }),
      }
    );

    // 6. Create the branch ref
    await this.request(
      `/repos/${owner}/${repo}/git/refs`,
      {
        method: 'POST',
        body: JSON.stringify({
          ref: `refs/heads/${branchName}`,
          sha: commit.sha,
        }),
      }
    );

    // 7. Create the pull request
    const pr = await this.request<{ number: number; html_url: string }>(
      `/repos/${owner}/${repo}/pulls`,
      {
        method: 'POST',
        body: JSON.stringify({
          title,
          body,
          head: branchName,
          base: baseBranch,
        }),
      }
    );

    return {
      pr_number: pr.number,
      pr_url: pr.html_url,
      branch: branchName,
    };
  }

  /**
   * Check if a branch exists on the remote.
   */
  async branchExists(owner: string, repo: string, branchName: string): Promise<boolean> {
    try {
      await this.request(`/repos/${owner}/${repo}/git/ref/heads/${branchName}`);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Create a new branch from a base branch.
   */
  async createBranchFromBase(
    owner: string,
    repo: string,
    branchName: string,
    baseBranch: string = 'main'
  ): Promise<{ sha: string }> {
    const baseRef = await this.request<{ object: { sha: string } }>(
      `/repos/${owner}/${repo}/git/ref/heads/${baseBranch}`
    );

    await this.request(
      `/repos/${owner}/${repo}/git/refs`,
      {
        method: 'POST',
        body: JSON.stringify({
          ref: `refs/heads/${branchName}`,
          sha: baseRef.object.sha,
        }),
      }
    );

    return { sha: baseRef.object.sha };
  }

  /**
   * Commit files to an existing branch using the Git Trees API.
   * Returns the new commit SHA.
   */
  async commitToExistingBranch(
    owner: string,
    repo: string,
    branchName: string,
    commitMessage: string,
    files: FileChange[]
  ): Promise<CommitResult> {
    // Get current HEAD of the branch
    const branchRef = await this.request<{ object: { sha: string } }>(
      `/repos/${owner}/${repo}/git/ref/heads/${branchName}`
    );
    const headSha = branchRef.object.sha;

    // Get the HEAD commit's tree
    const headCommit = await this.request<{ tree: { sha: string } }>(
      `/repos/${owner}/${repo}/git/commits/${headSha}`
    );
    const baseTreeSha = headCommit.tree.sha;

    // Create blobs for each file
    const treeItems: Array<{ path: string; mode: string; type: string; sha: string }> = [];
    for (const file of files) {
      const blob = await this.request<{ sha: string }>(
        `/repos/${owner}/${repo}/git/blobs`,
        {
          method: 'POST',
          body: JSON.stringify({ content: file.content, encoding: 'utf-8' }),
        }
      );
      treeItems.push({ path: file.path, mode: '100644', type: 'blob', sha: blob.sha });
    }

    // Create new tree
    const newTree = await this.request<{ sha: string }>(
      `/repos/${owner}/${repo}/git/trees`,
      {
        method: 'POST',
        body: JSON.stringify({ base_tree: baseTreeSha, tree: treeItems }),
      }
    );

    // Create commit with HEAD as parent
    const commit = await this.request<{ sha: string }>(
      `/repos/${owner}/${repo}/git/commits`,
      {
        method: 'POST',
        body: JSON.stringify({
          message: commitMessage,
          tree: newTree.sha,
          parents: [headSha],
        }),
      }
    );

    // Update the branch ref to point to the new commit
    await this.request(
      `/repos/${owner}/${repo}/git/refs/heads/${branchName}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ sha: commit.sha }),
      }
    );

    return { commit_sha: commit.sha };
  }

  /**
   * Update a pull request's body (description).
   */
  async updatePullRequestBody(
    owner: string,
    repo: string,
    prNumber: number,
    body: string
  ): Promise<void> {
    await this.request(
      `/repos/${owner}/${repo}/pulls/${prNumber}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ body }),
      }
    );
  }

  /**
   * Get a pull request's current body (description).
   */
  async getPullRequestBody(
    owner: string,
    repo: string,
    prNumber: number
  ): Promise<string> {
    const pr = await this.request<{ body: string }>(
      `/repos/${owner}/${repo}/pulls/${prNumber}`
    );
    return pr.body || '';
  }

  /**
   * Check if a pull request is still open.
   */
  async isPullRequestOpen(
    owner: string,
    repo: string,
    prNumber: number
  ): Promise<boolean> {
    const pr = await this.request<{ state: string }>(
      `/repos/${owner}/${repo}/pulls/${prNumber}`
    );
    return pr.state === 'open';
  }
}
