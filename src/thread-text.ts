/**
 * Small helpers for the thread text this server prints itself: the
 * list_open_threads rows and get_thread_context's fallback for backends
 * without the agent brief. The brief does the same on the server.
 */
import type { ThreadRepositoryLabel } from './api-client.js';

/** A form control's text is what someone typed into it (legacy rows kept it), never printed. */
const FIELD_TAGS = new Set(['input', 'textarea', 'select']);

export function isFormControlTag(tag: string | null | undefined): boolean {
  return FIELD_TAGS.has(String(tag || '').trim().toLowerCase());
}

/**
 * A page address without its query, where tokens and session ids live. A
 * hash route (#/settings) or a plain anchor stays; a fragment of key=value
 * pairs (#access_token=…) does not. Anything that is not an http(s) URL comes
 * back unchanged, minus anything after `?`.
 */
export function pageAddress(raw: string | null | undefined): string | null {
  const s = String(raw || '').trim();
  if (!s) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return s.split('?')[0] || null;
    const frag = u.hash.slice(1);
    const hash = /^!?\/[\w\-./%~]{0,120}$/.test(frag) || /^[\w\-.%]{1,60}$/.test(frag) ? `#${frag}` : '';
    return `${u.origin}${u.pathname}${hash}`;
  } catch {
    return s.split('?')[0] || null;
  }
}

/** An element's visible text on one line: line breaks as ⏎ (as the brief prints them), clipped. */
export function elementTextLine(text: string | null | undefined, max = 100): string {
  const s = String(text || '')
    .split(/\s*\n\s*/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(' ⏎ ');
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

const LANE_NAME: Record<string, string> = { design: 'Design', production: 'Production', qa: 'QA' };

export function laneName(lane: string | null | undefined): string | null {
  const s = String(lane || '').trim();
  if (!s) return null;
  return LANE_NAME[s.toLowerCase()] || s;
}

// The brief's repository kinds (backend services/threadRepository.ts), in words.
const REPOSITORY_KIND: Record<string, string> = {
  connected: "connected through Yocoolab's GitHub App (create_pr_for_thread works)",
  linked: 'linked in Yocoolab',
  'linked-other-lane': 'linked in Yocoolab for another lane',
  grouped: 'part of this Yocoolab project',
  'linked-ambiguous': 'several linked — get_thread_context lists them',
  inferred: 'inferred from the page URL — get_thread_context says how to confirm it',
  'not-linked': 'not linked in Yocoolab — get_thread_context says what to do',
};

/** The repository the API names for a thread, as one line; null when it names none. */
export function repositoryLabel(repository: string | ThreadRepositoryLabel | null | undefined): string | null {
  if (!repository) return null;
  if (typeof repository === 'string') return repository.replace(/\s+/g, ' ').trim().slice(0, 200) || null;
  const name = (repository.full_name || repository.url || '').trim();
  const kind = repository.kind ? REPOSITORY_KIND[repository.kind] || repository.kind : '';
  if (!name) return kind || null;
  return kind ? `${name} — ${kind}` : name;
}
