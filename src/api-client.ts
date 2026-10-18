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
  // Categorization the backend already returns (thread_summary view): the kind
  // of change the feedback concerns, and the board column the card sits in.
  service_type?: 'frontend' | 'api' | 'backend' | 'other' | null;
  kanban_stage?: 'backlog' | 'todo' | 'in_progress' | 'in_review' | 'done' | null;
  // Link-only projects (workspace key "project:<uuid>"): the repository links
  // the project points at ([{role, url}]), so a remote agent knows where to
  // open its PR. Returned by GET /threads and GET /threads/:id.
  repo_links?: RepoLink[];
  // The project-pipeline lane the thread's page belongs to (design /
  // production / qa), or null outside any lane. GET /threads and GET /:id.
  lane?: string | null;
  // GET /:id only, and only for a reader who can open the project.
  project_name?: string | null;
  environment?: string | null;
  // Which repository the thread belongs in, when the API names it (a label
  // string, or the brief's repository object). Not returned by GET /threads
  // today; printed by list_open_threads when it is.
  repository?: string | ThreadRepositoryLabel | null;
  // Elements pinned along with the main one; each may carry its own
  // screenshot (a data URL).
  attached_elements?: AttachedElement[] | null;
}

export interface ThreadRepositoryLabel {
  kind?: string | null;
  full_name?: string | null;
  url?: string | null;
}

export interface AttachedElement {
  tagName?: string | null;
  textContent?: string | null;
  description?: string | null;
  screenshot?: string | null;
}

export interface RepoLink {
  role: string;
  url: string;
}

export interface MessageDetail {
  id: string;
  thread_id: string;
  content: string;
  created_at: string;
  author_name: string;
  author_email: string;
  // Images posted with the message: {url} is a data:image/* URL or an https link.
  attachments?: Array<{ url?: string | null; type?: string | null; name?: string | null }> | null;
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

/**
 * GET /threads/:id/brief?format=json — the agent brief: one text, built on the
 * server, that says what to change, in which repository, how to find and check
 * it and how to report back. The dashboard and the extension copy the same
 * text. Only the fields this server reads are typed strictly.
 */
export interface AgentBrief {
  brief_version: number;
  markdown: string;
  repository: {
    kind: string;
    url: string | null;
    full_name: string | null;
    host: string | null;
    confirmed: boolean;
    candidates: { url: string; role: string | null }[];
    branch: string | null;
    branch_source: string;
    branch_use: 'base' | 'work' | null;
    base_branch: string | null;
    hint: string | null;
    project_name?: string | null;
    lane?: string | null;
    environment?: string | null;
  };
  /** The screenshots the brief's last line names, numbered in this order. */
  images: BriefImage[];
  close_loop: Record<string, unknown>;
  draft_count?: number;
}

export interface BriefImage {
  n: number;
  kind: 'element' | 'page' | 'attached_element' | 'sketch' | 'attachment';
  label: string;
  /** attached_element: its element number (2, 3, …). */
  element?: number;
  /** attachment: the conversation number of its message, and its index there. */
  message?: number;
  attachment?: number;
}

/** POST /threads/:id/addressed — what the backend recorded, and what it refused. */
export interface AddressedResult {
  ok: boolean;
  thread: {
    id: string;
    repo: string;
    status: string;
    kanban_stage: string | null;
    claude_code_pending: boolean;
    pr_url: string | null;
    pr_number: number | null;
    pr_branch: string | null;
  };
  message: { id: string; content: string } | null;
  recorded: { pr_url: string | null; pr_number: number | null; pr_branch: string | null; preview_url: string | null };
  rejected: { field: string; error: string }[];
}

/** GET /threads/:id/images — the thread's stored images, keyed by kind. */
export type ThreadImages = Record<string, { dataUrl: string | null; w?: number | null; h?: number | null } | undefined>;

/** A failed API call, with the HTTP status so callers can tell a missing route (404) from a refusal. */
export class YocoolabApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'YocoolabApiError';
    this.status = status;
  }
}

/**
 * The display name this agent signs its thread messages with. Reads
 * YOCOOLAB_AGENT_NAME at call time (same env the bridge registration uses) so
 * each agent profile — "Hermes Agent", "Claude Code", "Cursor", … — shows up
 * under its own name instead of everything being labeled "Claude Code".
 */
export function agentDisplayName(): string {
  const name = (process.env.YOCOOLAB_AGENT_NAME || '').trim();
  return name || 'Claude Code';
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
      throw new YocoolabApiError(`API request failed: ${response.status} ${response.statusText} — ${body}`, response.status);
    }

    return response.json() as Promise<T>;
  }

  /**
   * List threads, optionally filtered by status and branch. When `repo` is
   * omitted the backend returns the caller's full permission-scoped thread
   * pool across ALL connected repos — each thread carries its own `repo`, so
   * agents don't need a hardcoded repo list that goes stale as repos are added.
   */
  async listThreads(repo: string | undefined, options?: { status?: string; branch?: string; claude_code_pending?: boolean; target_agent_type?: string }): Promise<ThreadSummary[]> {
    const params = new URLSearchParams(repo ? { repo } : {});
    if (options?.status) params.set('status', options.status);
    if (options?.branch) params.set('branch', options.branch);
    if (options?.claude_code_pending !== undefined) params.set('claude_code_pending', String(options.claude_code_pending));
    if (options?.target_agent_type) params.set('target_agent_type', options.target_agent_type);
    return this.request<ThreadSummary[]>(`/threads?${params.toString()}`);
  }

  /**
   * Get full thread details including messages.
   */
  async getThread(threadId: string): Promise<ThreadDetail> {
    return this.request<ThreadDetail>(`/threads/${threadId}`);
  }

  /**
   * The agent brief for a thread (GET /threads/:id/brief?format=json).
   * `images: 'attached'` words its screenshot line for a client that sends
   * the images along, as get_thread_context does. Drafts are included unless
   * `drafts: false`. Returns null on 404: a backend from before the brief, or
   * one with the brief turned off (BRIEF_ENABLED=0) — callers build their own
   * text then.
   */
  async getThreadBrief(
    threadId: string,
    options: { drafts?: boolean; images?: 'attached' | 'paste' } = {}
  ): Promise<AgentBrief | null> {
    const params = new URLSearchParams({ format: 'json' });
    if (options.drafts === false) params.set('drafts', '0');
    if (options.images) params.set('images', options.images);
    try {
      return await this.request<AgentBrief>(`/threads/${encodeURIComponent(threadId)}/brief?${params.toString()}`);
    } catch (err) {
      if (err instanceof YocoolabApiError && err.status === 404) return null;
      throw err;
    }
  }

  /**
   * The thread's stored images (GET /threads/:id/images), keyed by kind —
   * `element` is the native-resolution crop of the pinned element. `kind`
   * fetches just that one. A backend without the route answers {}.
   */
  async getThreadImages(threadId: string, kind?: string): Promise<ThreadImages> {
    const qs = kind ? `?${new URLSearchParams({ kind }).toString()}` : '';
    try {
      return await this.request<ThreadImages>(`/threads/${encodeURIComponent(threadId)}/images${qs}`);
    } catch (err) {
      if (err instanceof YocoolabApiError && err.status === 404) return {};
      throw err;
    }
  }

  /** The thread's sketch (GET /threads/:id/sketch); `png` is a data URL. Null when there is none. */
  async getThreadSketch(threadId: string): Promise<{ png?: string | null } | null> {
    try {
      return await this.request<{ png?: string | null } | null>(`/threads/${encodeURIComponent(threadId)}/sketch`);
    } catch (err) {
      if (err instanceof YocoolabApiError && err.status === 404) return null;
      throw err;
    }
  }

  /**
   * Report the work on a thread in one call (POST /threads/:id/addressed):
   * the backend moves it to In Review and clears claude_code_pending (never
   * resolves it), records the PR links it accepts — a bad one is named in
   * `rejected` and blocks nothing — and posts the message as a reply signed
   * with this agent's name, with the notifications and live updates a reply
   * gets. Returns null on 404 (a backend from before the route); callers then
   * take the old PATCH + message path.
   */
  async addressThread(
    threadId: string,
    body: { message?: string; pr_url?: string | null; pr_branch?: string | null; preview_url?: string | null }
  ): Promise<AddressedResult | null> {
    const payload: Record<string, unknown> = { author_display_name: agentDisplayName() };
    for (const [k, v] of Object.entries(body)) if (v != null && v !== '') payload[k] = v;
    try {
      return await this.request<AddressedResult>(`/threads/${encodeURIComponent(threadId)}/addressed`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    } catch (err) {
      if (err instanceof YocoolabApiError && err.status === 404) return null;
      throw err;
    }
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
   * Add a message to a thread. Messages are signed with the agent's configured
   * display name (YOCOOLAB_AGENT_NAME) so different agents — Hermes profiles,
   * Claude Code, Cursor, etc. — are distinguishable in the thread. Falls back
   * to "Claude Code" for configs that never set a name.
   */
  async addMessage(threadId: string, content: string, repo: string): Promise<MessageDetail> {
    return this.request<MessageDetail>(`/threads/${threadId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content, repo, author_display_name: agentDisplayName() }),
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
      body: JSON.stringify({ repo, type, content, pr_url: prUrl, author_display_name: agentDisplayName(), include_self: true }),
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
