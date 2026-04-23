import { describe, it, expect, vi } from 'vitest';
import { handleGetDeploymentPreview } from '../../tools/get-deployment-preview.js';
import type { YocoolabApiClient } from '../../api-client.js';

function makeApi(getDeployments: (...args: any[]) => any): YocoolabApiClient {
  return { getDeployments } as unknown as YocoolabApiClient;
}

describe('handleGetDeploymentPreview', () => {
  it('returns preview URL when preview deployment exists', async () => {
    const api = makeApi(vi.fn().mockResolvedValue([
      {
        id: 'dep-1',
        repo: 'acme/site',
        branch: 'fix/button',
        url: 'https://fix-button.preview.acme.com',
        status: 'deployed',
        environment: 'preview',
        pr_number: 42,
        commit_sha: 'abc123',
        created_at: '2025-01-01T00:00:00Z',
      },
    ]));

    const result = await handleGetDeploymentPreview(api, { repo: 'acme/site', branch: 'fix/button' });

    expect(result.content[0].text).toContain('https://fix-button.preview.acme.com');
    expect(result.content[0].text).toContain('Preview deployment found');
  });

  it('falls back to non-preview deployment when no preview found', async () => {
    const api = makeApi(vi.fn()
      .mockResolvedValueOnce([]) // preview query returns empty
      .mockResolvedValueOnce([   // fallback query returns staging
        {
          id: 'dep-2',
          repo: 'acme/site',
          branch: 'fix/button',
          url: 'https://staging.acme.com',
          status: 'deployed',
          environment: 'staging',
          pr_number: null,
          commit_sha: 'def456',
          created_at: '2025-01-01T00:00:00Z',
        },
      ])
    );

    const result = await handleGetDeploymentPreview(api, { repo: 'acme/site', branch: 'fix/button' });

    expect(result.content[0].text).toContain('https://staging.acme.com');
    expect(result.content[0].text).toContain('Deployment found');
  });

  it('returns not-found message when no deployments exist', async () => {
    const api = makeApi(vi.fn().mockResolvedValue([]));

    const result = await handleGetDeploymentPreview(api, { repo: 'acme/site', branch: 'fix/button' });

    expect(result.content[0].text).toContain('No deployment found yet');
    expect(result.content[0].text).toContain('Try again in 30 seconds');
  });

  it('includes commit sha when available', async () => {
    const api = makeApi(vi.fn().mockResolvedValue([
      {
        id: 'dep-1',
        repo: 'acme/site',
        branch: 'fix/button',
        url: 'https://preview.acme.com',
        status: 'deployed',
        environment: 'preview',
        pr_number: null,
        commit_sha: 'abc123def',
        created_at: '2025-01-01T00:00:00Z',
      },
    ]));

    const result = await handleGetDeploymentPreview(api, { repo: 'acme/site', branch: 'fix/button' });

    expect(result.content[0].text).toContain('abc123def');
  });

  it('passes correct filters to getDeployments', async () => {
    const mockGetDeployments = vi.fn().mockResolvedValue([]);
    const api = makeApi(mockGetDeployments);

    await handleGetDeploymentPreview(api, { repo: 'acme/site', branch: 'fix/button' });

    expect(mockGetDeployments).toHaveBeenCalledWith('acme/site', {
      branch: 'fix/button',
      status: 'deployed',
      environment: 'preview',
      limit: 1,
    });
  });
});
