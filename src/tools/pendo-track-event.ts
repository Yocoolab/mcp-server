import { PendoClient } from '../pendo-client.js';

export async function handlePendoTrackEvent(
  pendo: PendoClient,
  args: { event_name: string; visitor_id?: string; account_id?: string; properties?: string }
) {
  try {
    let parsedProperties: Record<string, any> | undefined;
    if (args.properties) {
      try {
        parsedProperties = JSON.parse(args.properties);
      } catch {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'Error: properties must be a valid JSON string.',
            },
          ],
          isError: true,
        };
      }
    }

    await pendo.trackEvent({
      type: 'track',
      event: args.event_name,
      visitorId: args.visitor_id,
      accountId: args.account_id,
      timestamp: Date.now(),
      properties: parsedProperties,
    });

    return {
      content: [
        {
          type: 'text' as const,
          text: `Track event "${args.event_name}" sent to Pendo successfully.`,
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error sending track event: ${(error as Error).message}`,
        },
      ],
      isError: true,
    };
  }
}
