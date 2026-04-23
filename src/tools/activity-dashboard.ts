export function handleGetDashboardUrl(port: number) {
  return {
    content: [
      {
        type: 'text' as const,
        text: `Activity Monitor Dashboard: http://localhost:${port}/dashboard/\n\nOpen this URL in your browser to see real-time Claude Code activity, tool usage charts, and session timelines.`,
      },
    ],
  };
}
