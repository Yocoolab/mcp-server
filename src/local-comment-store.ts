import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * No-account ("local") comments, pushed over the local bridge.
 *
 * When the person uses Yocoolab without signing in, their comments live only
 * in the extension's own IndexedDB and never reach the server — so the
 * token-gated thread tools (list_open_threads, get_thread_context, …) can't
 * see them. The extension POSTs the site's local threads to the bridge's
 * /local-comments route whenever they change.
 *
 * The store is backed by a SHARED JSON FILE, not per-process memory. A machine
 * runs several mcp-server processes at once (Claude Desktop, Hermes profiles, a
 * runner) and only one owns the bridge port — but every one of them reads and
 * writes the same file, so whichever process serves a given agent's
 * list_local_threads call sees the comments the bridge received, no matter
 * which process received them. Still fully local: the file lives on this
 * machine and nothing touches the network or a token.
 */

const DEFAULT_FILE = path.join(os.homedir(), '.yocoolab', 'local-comments.json');

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
  private file: string;

  constructor(file?: string) {
    this.file = file || process.env.YOCOOLAB_LOCAL_STORE || DEFAULT_FILE;
  }

  /** Read the whole origin→snapshot map from the shared file (empty on any error). */
  private readAll(): Record<string, LocalCommentSnapshot> {
    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed as Record<string, LocalCommentSnapshot> : {};
    } catch {
      return {};
    }
  }

  /** Write the whole map back, atomically (tmp + rename) so a concurrent reader
   *  never sees a half-written file. Swallows errors — the store is best-effort. */
  private writeAll(map: Record<string, LocalCommentSnapshot>): void {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp-${process.pid}`;
      fs.writeFileSync(tmp, JSON.stringify(map));
      fs.renameSync(tmp, this.file);
    } catch {
      /* best-effort: a read-only FS or race just means this push is dropped */
    }
  }

  /** Replace the snapshot for an origin with the one the extension just pushed. */
  set(origin: string, data: { page?: { url?: string; title?: string }; threads: Array<Record<string, unknown>> }): void {
    const map = this.readAll();
    map[origin] = {
      origin,
      page: data.page,
      threads: Array.isArray(data.threads) ? data.threads : [],
      updatedAt: Date.now(),
    };
    this.writeAll(map);
  }

  get(origin: string): LocalCommentSnapshot | undefined {
    return this.readAll()[origin];
  }

  /** Origins that have at least one thread, most-recently-updated first. */
  origins(): LocalCommentSnapshot[] {
    return Object.values(this.readAll())
      .filter((s) => s && Array.isArray(s.threads) && s.threads.length > 0)
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
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
    this.writeAll({});
  }

  // ─── Agent → extension write-back queue ──────────────────────────────────
  // create_local_comments runs in whatever process serves the agent, which is
  // usually NOT the one that owns the bridge (and so has no SSE clients). It
  // appends the pins here; the bridge-owning process drains this shared queue
  // and pushes them to the extension over SSE. So an agent can create pins
  // without owning the bridge.
  private queueFile(): string {
    return path.join(path.dirname(this.file), 'local-creates.json');
  }

  /** Append agent-created pins to the shared queue. Returns how many were queued. */
  enqueueCreate(items: Array<Record<string, unknown>>): number {
    try {
      const qf = this.queueFile();
      let q: unknown[] = [];
      try { const r = JSON.parse(fs.readFileSync(qf, 'utf8')); if (Array.isArray(r)) q = r; } catch { /* empty */ }
      q.push({ ts: Date.now(), items });
      fs.mkdirSync(path.dirname(qf), { recursive: true });
      const tmp = `${qf}.tmp-${process.pid}`;
      fs.writeFileSync(tmp, JSON.stringify(q));
      fs.renameSync(tmp, qf);
      return items.length;
    } catch { return 0; }
  }

  /** Remove and return all queued pin items (the bridge owner calls this). */
  drainCreates(): Array<Record<string, unknown>> {
    try {
      const qf = this.queueFile();
      let q: Array<{ items?: unknown[] }> = [];
      try { const r = JSON.parse(fs.readFileSync(qf, 'utf8')); if (Array.isArray(r)) q = r; } catch { return []; }
      if (!q.length) return [];
      const tmp = `${qf}.tmp-${process.pid}`;
      fs.writeFileSync(tmp, '[]');
      fs.renameSync(tmp, qf);
      const out: Array<Record<string, unknown>> = [];
      for (const e of q) if (e && Array.isArray(e.items)) out.push(...(e.items as Array<Record<string, unknown>>));
      return out;
    } catch { return []; }
  }
}
