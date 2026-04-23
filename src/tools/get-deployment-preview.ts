import { YocoolabApiClient } from '../api-client.js';

export async function handleGetDeploymentPreview(
  api: YocoolabApiClient,
  args: { repo: string; branch: string }
) {
  // Try preview environment first
  const previews = await api.getDeployments(args.repo, {
    branch: args.branch,
    status: 'deployed',
    environment: 'preview',
    limit: 1,
  });

  if (previews.length > 0) {
    const d = previews[0];
    return {
      content: [
        {
          type: 'text' as const,
          text: [
            `Preview deployment found for ${args.repo} on branch "${args.branch}":`,
            ``,
            `**Preview URL:** ${d.url}`,
            `**Status:** ${d.status}`,
            `**Environment:** ${d.environment}`,
            `**Deployed at:** ${d.created_at}`,
            d.commit_sha ? `**Commit:** ${d.commit_sha}` : '',
          ].filter(Boolean).join('\n'),
        },
      ],
    };
  }

  // Fall back to any deployed environment
  const allDeployed = await api.getDeployments(args.repo, {
    branch: args.branch,
    status: 'deployed',
    limit: 1,
  });

  if (allDeployed.length > 0) {
    const d = allDeployed[0];
    return {
      content: [
        {
          type: 'text' as const,
          text: [
            `Deployment found for ${args.repo} on branch "${args.branch}":`,
            ``,
            `**Preview URL:** ${d.url}`,
            `**Status:** ${d.status}`,
            `**Environment:** ${d.environment}`,
            `**Deployed at:** ${d.created_at}`,
            d.commit_sha ? `**Commit:** ${d.commit_sha}` : '',
          ].filter(Boolean).join('\n'),
        },
      ],
    };
  }

  return {
    content: [
      {
        type: 'text' as const,
        text: `No deployment found yet for ${args.repo} on branch "${args.branch}". The deployment may still be building. Try again in 30 seconds.`,
      },
    ],
  };
}
