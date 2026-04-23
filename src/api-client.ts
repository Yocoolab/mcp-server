/**
 * Yocoolab REST API client.
 * Communicates with the backend to fetch threads, messages, and update state.
 */

export interface ThreadSummary {
  id: string;
  repo: string;
  branch: string;
  status: 'open' | 'resolved';
  priority: 'low' | 'normal' | 'high' | 'critical';
  selector: string | null;
  xpath: string | null;
  coordinates: { x: number; y: number } | null;
  screenshot_url: string | null;
  element_tag: string | null;
  element_text: string | null;
  view_context: Record<string, unknown> | null;
  element_context: Record<string, unknown> | null;
  page_url: string | null;
  tags: string[];
  created_by: string;
  created_at: string;
  jira_issue_key: string | null;
  pr_number: number | null;
  pr_url: string | null;
  pr_branch: string | null;
  jira_status: string | null;
  jira_status_category: string | null;
  fix_commit_sha: string | null;
  working_branch_id: string | null;
  claude_code_pending: boolean;
  claude_code_pending_at: string | null;
  parent_thread_id: string | null;
  iteration_type: 'refinement' | 'revision' | null;
  iteration_number: number | null;
  creator_name: string;
  creator_email: string;
  message_count: number;
  last_activity: string | null;
}

export interface MessageDetail {
  id: string;
  thread_id: string;
  content: string;
  created_at: string;
  author_name: string;
  author_email: string;
}

export interface IterationSummary {
  id: string;
  iteration_type: string;
  iteration_number: number;
  status: string;
  first_message_content: string | null;
  pr_url: string | null;
  created_at: string;
}

export interface ParentThreadInfo {
  id: string;
  first_message_content: string | null;
  status: string;
  pr_url: string | null;
  screenshot_url?: string | null;
  page_url?: string | null;
  messages?: MessageDetail[];
}

export interface ThreadDetail extends ThreadSummary {
  messages: MessageDetail[];
  iterations?: IterationSummary[];
  parent_thread?: ParentThreadInfo | null;
}

export interface WorkingBranchInfo {
  id: string;
  repo: string;
  base_branch: string;
  branch_name: string;
  pr_number: number | null;
  pr_url: string | null;
  status: 'active' | 'merged' | 'closed';
  head_sha: string | null;
  thread_count: number;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface DeploymentInfo {
  id: string;
  repo: string;
  branch: string;
  url: string;
  status: string;
  environment: string;
  pr_number: number | null;
  commit_sha: string | null;
  created_at: string;
}

export class YocoolabApiClient {
  private baseUrl: string;
  private token: string;

  constructor(baseUrl: string, token: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.token = token;
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}/api/v1${path}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'Yocoolab-MCP-Server',
        ...options.headers,
      },
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`API request failed: ${response.status} ${response.statusText} — ${body}`);
    }

    return response.json() as Promise<T>;
  }

  /**
   * List threads for a repository, optionally filtered by status and branch.
   */
  async listThreads(repo: string, options?: { status?: string; branch?: string; claude_code_pending?: boolean }): Promise<ThreadSummary[]> {
    const params = new URLSearchParams({ repo });
    if (options?.status) params.set('status', options.status);
    if (options?.branch) params.set('branch', options.branch);
    if (options?.claude_code_pending !== undefined) params.set('claude_code_pending', String(options.claude_code_pending));
    return this.request<ThreadSummary[]>(`/threads?${params.toString()}`);
  }

  /**
   * Get full thread details including messages.
   */
  async getThread(threadId: string): Promise<ThreadDetail> {
    return this.request<ThreadDetail>(`/threads/${threadId}`);
  }

  /**
   * Update a thread (e.g., set PR fields, resolve).
   */
  async updateThread(
    threadId: string,
    repo: string,
    updates: Record<string, unknown>
  ): Promise<ThreadSummary> {
    return this.request<ThreadSummary>(`/threads/${threadId}`, {
      method: 'PATCH',
      body: JSON.stringify({ repo, ...updates }),
    });
  }

  /**
   * Add a message to a thread.
   */
  async addMessage(threadId: string, content: string, repo: string): Promise<MessageDetail> {
    return this.request<MessageDetail>(`/threads/${threadId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content, repo, author_display_name: 'Claude Code' }),
    });
  }

  /**
   * Query deployments for a repo/branch.
   */
  async getDeployments(
    repo: string,
    options?: { branch?: string; status?: string; environment?: string; limit?: number }
  ): Promise<DeploymentInfo[]> {
    const params = new URLSearchParams({ repo });
    if (options?.branch) params.set('branch', options.branch);
    if (options?.status) params.set('status', options.status);
    if (options?.environment) params.set('environment', options.environment);
    if (options?.limit) params.set('limit', String(options.limit));
    return this.request<DeploymentInfo[]>(`/deployments?${params.toString()}`);
  }

  /**
   * Get the active working branch for a repo.
   */
  async getWorkingBranch(repo: string): Promise<WorkingBranchInfo | null> {
    const params = new URLSearchParams({ repo });
    return this.request<WorkingBranchInfo | null>(`/working-branches?${params.toString()}`);
  }

  /**
   * Create a new working branch record.
   */
  async createWorkingBranch(data: {
    repo: string;
    base_branch?: string;
    branch_name: string;
    head_sha?: string;
    pr_number?: number;
    pr_url?: string;
    description?: string;
  }): Promise<WorkingBranchInfo> {
    return this.request<WorkingBranchInfo>('/working-branches', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  /**
   * Update a working branch record.
   */
  async updateWorkingBranch(
    id: string,
    updates: Record<string, unknown>
  ): Promise<WorkingBranchInfo> {
    return this.request<WorkingBranchInfo>(`/working-branches/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
  }

  /**
   * Notify thread participants (e.g., PR created).
   */
  async notifyParticipants(
    threadId: string,
    repo: string,
    type: string,
    content: string,
    prUrl?: string
  ): Promise<{ notified: number; message: string }> {
    return this.request<{ notified: number; message: string }>(`/threads/${threadId}/notify`, {
      method: 'POST',
      body: JSON.stringify({ repo, type, content, pr_url: prUrl, author_display_name: 'Claude Code', include_self: true }),
    });
  }

  /**
   * Register a repo URL pattern so the Chrome extension recognizes the page.
   */
  async registerRepoUrl(params: {
    repo: string;
    url_pattern: string;
    environment: string;
    branch?: string;
    description: string;
  }): Promise<void> {
    await this.request('/repo-urls', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }

  /**
   * Send a chat message to the AI assistant with optional screenshot and page context.
   */
  async analyzePageWithAI(params: {
    message: string;
    screenshot?: string;
    pageContext?: {
      url: string;
      title: string;
      headings?: string[];
      bodyText?: string;
      elementContext?: {
        selector?: string;
        tag?: string;
        text?: string;
      };
    };
    conversationHistory?: Array<{ role: string; content: string }>;
  }): Promise<{ reply: string; model: string; usage: { input_tokens: number; output_tokens: number } }> {
    return this.request('/assistant/chat', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }

  /**
   * List AI conversations for the authenticated user.
   */
  async getAiConversations(): Promise<{
    conversations: Array<{
      id: string;
      page_url: string | null;
      message_count: number;
      last_message_at: string;
      created_at: string;
    }>;
  }> {
    return this.request('/assistant/conversations');
  }
}
