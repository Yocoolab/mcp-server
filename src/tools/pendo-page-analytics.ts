import { PendoClient } from '../pendo-client.js';

export async function handlePendoPageAnalytics(
  pendo: PendoClient,
  args: { page_url_pattern: string; days?: number }
) {
  const days = args.days || 30;
  const startTime = Date.now() - days * 24 * 60 * 60 * 1000;

  try {
    const result = await pendo.aggregate([
      {
        source: {
          pageEvents: {
            pageId: args.page_url_pattern,
          },
          timeSeries: {
            first: `${startTime}`,
            count: days,
            period: 'dayRange',
          },
        },
      },
      {
        reduce: {
          numEvents: { sum: 'numEvents' },
          numVisitors: { sum: 'numVisitors' },
          avgTime: { avg: 'totalTime' },
        },
      },
    ]);

    const data = result?.results?.[0];
    if (!data) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `No page analytics found for "${args.page_url_pattern}" in the last ${days} days.`,
          },
        ],
      };
    }

    const avgTimeSeconds = data.avgTime ? Math.round(data.avgTime / 1000) : null;

    return {
      content: [
        {
          type: 'text' as const,
          text: [
            `**Page Analytics: "${args.page_url_pattern}"** (last ${days} days)`,
            '',
            `- Total page views: ${data.numEvents ?? 'N/A'}`,
            `- Unique visitors: ${data.numVisitors ?? 'N/A'}`,
            avgTimeSeconds !== null
              ? `- Avg time on page: ${avgTimeSeconds}s`
              : '- Avg time on page: N/A',
          ].join('\n'),
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error fetching page analytics: ${(error as Error).message}`,
        },
      ],
      isError: true,
    };
  }
}
