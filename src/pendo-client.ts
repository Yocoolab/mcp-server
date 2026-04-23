/**
 * Standalone Pendo API client for MCP tools.
 * Talks directly to Pendo API — separate from the backend service.
 */
export class PendoClient {
  private apiBase: string;
  private integrationKey: string;

  constructor(integrationKey: string, apiBase = 'https://app.pendo.io/api/v1') {
    this.integrationKey = integrationKey;
    this.apiBase = apiBase.replace(/\/+$/, '');
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.apiBase}${path}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        'x-pendo-integration-key': this.integrationKey,
        'Content-Type': 'application/json',
        'User-Agent': 'Yocoolab-MCP-Server/1.0',
        ...options.headers,
      },
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Pendo API error: ${response.status} ${response.statusText} — ${body}`);
    }

    return response.json() as Promise<T>;
  }

  /**
   * Run an aggregation query against the Pendo Aggregation API.
   */
  async aggregate(pipeline: object): Promise<any> {
    return this.request('/aggregation', {
      method: 'POST',
      body: JSON.stringify({
        response: { mimeType: 'application/json' },
        request: { pipeline },
      }),
    });
  }

  /**
   * Send a track event to Pendo.
   */
  async trackEvent(event: {
    type: string;
    event: string;
    visitorId?: string;
    accountId?: string;
    timestamp: number;
    properties?: Record<string, any>;
  }): Promise<void> {
    await this.request('/track', {
      method: 'POST',
      body: JSON.stringify(event),
    });
  }

  /**
   * List all guides.
   */
  async listGuides(): Promise<any[]> {
    return this.request('/guide');
  }
}
