import * as fs from 'node:fs';
import * as path from 'node:path';
import type { MappingCandidate, ElementSelectedPayload } from './types.js';

const SEARCHABLE_EXTENSIONS = new Set([
  '.tsx', '.jsx', '.ts', '.js', '.vue', '.svelte', '.html',
]);

const SKIP_DIRS = new Set([
  'node_modules', 'dist', 'build', '.next', '.git',
  '.svelte-kit', '__pycache__', '.turbo', '.cache',
]);

const MAX_FILES = 500;

function collectFiles(dir: string, collected: string[] = []): string[] {
  if (collected.length >= MAX_FILES) return collected;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return collected;
  }

  for (const entry of entries) {
    if (collected.length >= MAX_FILES) break;

    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
        collectFiles(path.join(dir, entry.name), collected);
      }
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name);
      if (SEARCHABLE_EXTENSIONS.has(ext)) {
        collected.push(path.join(dir, entry.name));
      }
    }
  }

  return collected;
}

function offsetToLine(text: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text[i] === '\n') line++;
  }
  return line;
}

function getLineText(text: string, lineIndex: number): string {
  const lines = text.split('\n');
  return lineIndex >= 0 && lineIndex < lines.length ? lines[lineIndex] : '';
}

function lineCount(text: string): number {
  return text.split('\n').length;
}

export async function mapElementToSource(
  payload: ElementSelectedPayload,
  workspaceRoot: string
): Promise<MappingCandidate[]> {
  const element = payload.element;
  const candidates: MappingCandidate[] = [];
  const files = collectFiles(workspaceRoot);

  const searchPromises: Promise<void>[] = [];

  if (element.text && element.text.length > 2 && element.text.length < 100) {
    searchPromises.push(searchByPattern(element.text, files, 'text', candidates));
  }

  if (element.id) {
    searchPromises.push(searchByPattern(element.id, files, 'id', candidates));
  }

  if (element.attributes?.['aria-label']) {
    searchPromises.push(
      searchByPattern(element.attributes['aria-label'], files, 'ariaLabel', candidates)
    );
  }

  const meaningfulClasses = (element.classList || []).filter(
    (c: string) =>
      c.length > 2 &&
      !c.match(
        /^(p|m|w|h|d|flex|grid|block|inline|hidden|relative|absolute|text|bg|border|rounded|shadow|overflow|cursor|transition|transform|opacity|z)-/i
      )
  );
  for (const cls of meaningfulClasses.slice(0, 3)) {
    searchPromises.push(searchByPattern(cls, files, 'className', candidates));
  }

  await Promise.all(searchPromises);

  // Deduplicate
  const seen = new Set<string>();
  const deduplicated = candidates.filter((c) => {
    const key = `${c.filePath}:${c.lineStart}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Boost confidence for multiple matches in same file
  const fileMatchCounts = new Map<string, number>();
  for (const c of deduplicated) {
    fileMatchCounts.set(c.filePath, (fileMatchCounts.get(c.filePath) || 0) + 1);
  }
  for (const c of deduplicated) {
    const count = fileMatchCounts.get(c.filePath) || 1;
    if (count > 1) {
      c.confidence = Math.min(1, c.confidence + 0.1 * (count - 1));
      c.reason += ` (+${count} matches in file)`;
    }
  }

  return deduplicated.sort((a, b) => b.confidence - a.confidence).slice(0, 10);
}

async function searchByPattern(
  pattern: string,
  files: string[],
  matchType: string,
  candidates: MappingCandidate[]
): Promise<void> {
  for (const filePath of files) {
    let text: string;
    try {
      text = fs.readFileSync(filePath, 'utf-8');
    } catch {
      continue;
    }

    const idx = text.indexOf(pattern);
    if (idx === -1) continue;

    const line = offsetToLine(text, idx);
    const totalLines = lineCount(text);
    const lineStart = Math.max(1, line - 2);
    const lineEnd = Math.min(totalLines, line + 2);

    let confidence = 0.3;
    let reason = '';

    switch (matchType) {
      case 'text': {
        const lt = getLineText(text, line - 1);
        if (lt.includes('>') || lt.includes('<')) {
          confidence = 0.7;
          reason = `Text "${pattern.slice(0, 30)}" found in markup`;
        } else {
          confidence = 0.4;
          reason = `Text "${pattern.slice(0, 30)}" found in source`;
        }
        break;
      }
      case 'id':
        confidence = 0.85;
        reason = `ID "${pattern}" matched`;
        break;
      case 'ariaLabel':
        confidence = 0.8;
        reason = `aria-label "${pattern}" matched`;
        break;
      case 'className':
        confidence = 0.5;
        reason = `Class "${pattern}" found`;
        break;
      default:
        confidence = 0.3;
        reason = `Pattern "${pattern.slice(0, 20)}" matched`;
    }

    // Boost for PascalCase filenames (component files)
    const fileName = path.basename(filePath, path.extname(filePath));
    if (
      fileName[0] === fileName[0].toUpperCase() &&
      fileName[0] !== fileName[0].toLowerCase()
    ) {
      confidence += 0.05;
    }

    // Boost for JSX/TSX files
    if (filePath.endsWith('.tsx') || filePath.endsWith('.jsx')) {
      confidence += 0.05;
    }

    candidates.push({
      filePath,
      lineStart,
      lineEnd,
      confidence: Math.min(1, confidence),
      reason,
      matchType: matchType as MappingCandidate['matchType'],
    });
  }
}
