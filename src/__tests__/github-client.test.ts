import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GitHubClient } from '../github-client.js';
import type { FileChange } from '../github-client.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function jsonResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  };
}

describe('GitHubClient', () => {
  let github: GitHubClient;

  beforeEach(() => {
    mockFetch.mockReset();
    github = new GitHubClient('ghp_test_token');
  });

  function setupSuccessfulPrFlow(files: FileChange[]) {
    // 1. Get base branch SHA
    mockFetch.mockResolvedValueOnce(jsonResponse({ object: { sha: 'base-sha-123' } }));
    // 2. Get base commit tree
    mockFetch.mockResolvedValueOnce(jsonResponse({ tree: { sha: 'tree-sha-456' } }));
    // 3. Create blobs (one per file)
    for (let i = 0; i < files.length; i++) {
      mockFetch.mockResolvedValueOnce(jsonResponse({ sha: `blob-sha-${i}` }));
    }
    // 4. Create tree
    mockFetch.mockResolvedValueOnce(jsonResponse({ sha: 'new-tree-sha' }));
    // 5. Create commit
    mockFetch.mockResolvedValueOnce(jsonResponse({ sha: 'commit-sha-789' }));
    // 6. Create branch ref
    mockFetch.mockResolvedValueOnce(jsonResponse({}));
    // 7. Create PR
    mockFetch.mockResolvedValueOnce(jsonResponse({ number: 42, html_url: 'https://github.com/owner/repo/pull/42' }));
  }

  it('creates a PR through the full 7-step API sequence', async () => {
    const files: FileChange[] = [{ path: 'src/Button.tsx', content: 'export default () => <button/>' }];
    setupSuccessfulPrFlow(files);

    const result = await github.createPullRequest('owner', 'repo', 'fix/btn', 'Fix button', 'Body', files);

    expect(result).toEqual({
      pr_number: 42,
      pr_url: 'https://github.com/owner/repo/pull/42',
      branch: 'fix/btn',
    });

    // Verify 7 API calls made
    expect(mockFetch).toHaveBeenCalledTimes(7);

    // Step 1: Get base branch
    expect(mockFetch.mock.calls[0][0]).toContain('/repos/owner/repo/git/ref/heads/main');
    // Step 2: Get commit
    expect(mockFetch.mock.calls[1][0]).toContain('/repos/owner/repo/git/commits/base-sha-123');
    // Step 3: Create blob
    expect(mockFetch.mock.calls[2][0]).toContain('/repos/owner/repo/git/blobs');
    // Step 4: Create tree
    expect(mockFetch.mock.calls[3][0]).toContain('/repos/owner/repo/git/trees');
    // Step 5: Create commit
    expect(mockFetch.mock.calls[4][0]).toContain('/repos/owner/repo/git/commits');
    // Step 6: Create branch
    expect(mockFetch.mock.calls[5][0]).toContain('/repos/owner/repo/git/refs');
    // Step 7: Create PR
    expect(mockFetch.mock.calls[6][0]).toContain('/repos/owner/repo/pulls');
  });

  it('creates blobs for multiple files', async () => {
    const files: FileChange[] = [
      { path: 'src/A.tsx', content: 'A content' },
      { path: 'src/B.tsx', content: 'B content' },
      { path: 'src/C.tsx', content: 'C content' },
    ];
    setupSuccessfulPrFlow(files);

    await github.createPullRequest('owner', 'repo', 'feat/multi', 'Multi file', 'Body', files);

    // 7 base calls + 2 extra blobs = 9 total
    expect(mockFetch).toHaveBeenCalledTimes(9);
  });

  it('sets Authorization header with Bearer token', async () => {
    const files: FileChange[] = [{ path: 'f.ts', content: 'x' }];
    setupSuccessfulPrFlow(files);

    await github.createPullRequest('o', 'r', 'b', 't', 'body', files);

    for (const call of mockFetch.mock.calls) {
      expect(call[1].headers['Authorization']).toBe('Bearer ghp_test_token');
    }
  });

  it('uses custom baseBranch when specified', async () => {
    const files: FileChange[] = [{ path: 'f.ts', content: 'x' }];
    setupSuccessfulPrFlow(files);

    await github.createPullRequest('o', 'r', 'b', 't', 'body', files, 'develop');

    expect(mockFetch.mock.calls[0][0]).toContain('/git/ref/heads/develop');
    // PR base should be develop
    const prBody = JSON.parse(mockFetch.mock.calls[6][1].body);
    expect(prBody.base).toBe('develop');
  });

  it('propagates error from API failure', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      text: () => Promise.resolve('Branch not found'),
    });

    await expect(
      github.createPullRequest('o', 'r', 'b', 't', 'body', [{ path: 'f.ts', content: 'x' }])
    ).rejects.toThrow('GitHub API error: 404');
  });
});
