import { PendoClient } from '../pendo-client.js';

export async function handlePendoFeatureUsage(
  pendo: PendoClient,
  args: { feature_name: string; days?: number }
) {
  const days = args.days || 30;
  const startTime = Date.now() - days * 24 * 60 * 60 * 1000;

  try {
    const result = await pendo.aggregate([
      {
        source: {
          featureEvents: null,
          timeSeries: {
            first: `${startTime}`,
            count: days,
            period: 'dayRange',
          },
        },
      },
      {
        filter: `featureName == "${args.feature_name}"`,
      },
      {
        reduce: {
          numEvents: { sum: 'numEvents' },
          numVisitors: { sum: 'numVisitors' },
        },
      },
    ]);

    const data = result?.results?.[0];
    if (!data) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `No usage data found for feature "${args.feature_name}" in the last ${days} days.`,
          },
        ],
      };
    }

    return {
      content: [
        {
          type: 'text' as const,
          text: [
            `**Feature Usage: "${args.feature_name}"** (last ${days} days)`,
            '',
            `- Total events: ${data.numEvents ?? 'N/A'}`,
            `- Unique visitors: ${data.numVisitors ?? 'N/A'}`,
          ].join('\n'),
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error fetching feature usage: ${(error as Error).message}`,
        },
      ],
      isError: true,
    };
  }
}
