/**
 * No-account ("local") comments, pushed over the local bridge.
 *
 * When the person uses Yocoolab without signing in, their comments live only
 * in the extension's own IndexedDB and never reach the server — so the
 * token-gated thread tools (list_open_threads, get_thread_context, …) can't
 * see them. The extension instead POSTs the site's local threads to the
 * bridge's /local-comments route whenever they change, and this store holds
 * the latest snapshot per origin so the tokenless local-comment tools can
 * hand them to the agent. Nothing here ever touches the network or a token.
 */

export interface LocalCommentSnapshot {
  /** The page origin these threads belong to, e.g. "https://example.com". */
  origin: string;
  /** The page the extension last pushed from (best-effort). */
  page?: { url?: string; title?: string };
  /** Threads in the extension's own `ycLocalView` shape (full, with messages). */
  threads: Array<Record<string, unknown>>;
  /** When this snapshot was received (ms). */
  updatedAt: number;
}

/** A single thread flattened with the origin it came from. */
export interface LocalThreadWithOrigin {
  origin: string;
  thread: Record<string, unknown>;
}

export class LocalCommentStore {
  private byOrigin = new Map<string, LocalCommentSnapshot>();

  /** Replace the snapshot for an origin with the one the extension just pushed. */
  set(origin: string, data: { page?: { url?: string; title?: string }; threads: Array<Record<string, unknown>> }): void {
    this.byOrigin.set(origin, {
      origin,
      page: data.page,
      threads: Array.isArray(data.threads) ? data.threads : [],
      updatedAt: Date.now(),
    });
  }

  get(origin: string): LocalCommentSnapshot | undefined {
    return this.byOrigin.get(origin);
  }

  /** Origins that have at least one thread, most-recently-updated first. */
  origins(): LocalCommentSnapshot[] {
    return [...this.byOrigin.values()]
      .filter((s) => s.threads.length > 0)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /** The snapshot updated most recently (the page the person is likely on). */
  latest(): LocalCommentSnapshot | null {
    const all = this.origins();
    return all.length ? all[0] : null;
  }

  /** Every thread across every origin, newest origin first. */
  allThreads(): LocalThreadWithOrigin[] {
    const out: LocalThreadWithOrigin[] = [];
    for (const snap of this.origins()) {
      for (const thread of snap.threads) out.push({ origin: snap.origin, thread });
    }
    return out;
  }

  /** Find one thread by its id across all origins. */
  findThread(id: string): LocalThreadWithOrigin | undefined {
    return this.allThreads().find((t) => String(t.thread.id) === String(id));
  }

  count(): number {
    return this.allThreads().length;
  }

  clear(): void {
    this.byOrigin.clear();
  }
}
