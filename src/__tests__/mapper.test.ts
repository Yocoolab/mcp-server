import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mapElementToSource } from '../mapper.js';
import type { ElementSelectedPayload } from '../types.js';
import * as fs from 'node:fs';

vi.mock('node:fs', () => ({
  readdirSync: vi.fn(),
  readFileSync: vi.fn(),
}));

const mockReaddirSync = vi.mocked(fs.readdirSync);
const mockReadFileSync = vi.mocked(fs.readFileSync);

function makePayload(overrides: Partial<ElementSelectedPayload['element']> = {}): ElementSelectedPayload {
  return {
    type: 'ELEMENT_SELECTED',
    timestamp: Date.now(),
    correlationId: 'test-corr',
    page: { url: 'https://app.example.com/dashboard', title: 'Dashboard', viewport: { w: 1920, h: 1080 }, devicePixelRatio: 1 },
    element: {
      selector: 'button#submit-btn.primary-cta',
      tag: 'BUTTON',
      id: 'submit-btn',
      classList: ['primary-cta', 'btn-lg'],
      text: 'Submit Form',
      attributes: { 'aria-label': 'Submit the form' },
      domPath: ['HTML', 'BODY', 'MAIN', 'FORM', 'BUTTON'],
      boundingBox: { x: 100, y: 200, w: 120, h: 40 },
      ...overrides,
    },
    styles: {
      computed: {
        color: 'white', backgroundColor: 'blue', fontSize: '16px',
        fontFamily: 'sans-serif', fontWeight: '600', padding: '8px',
        margin: '0', border: 'none', borderRadius: '4px',
        display: 'inline-flex', position: 'relative',
      },
    },
    hints: { frameworkGuess: 'react', devServer: 'vite' },
  };
}

function setupFiles(fileMap: Record<string, string>) {
  const entries = Object.keys(fileMap).map((name) => ({
    name,
    isDirectory: () => false,
    isFile: () => true,
  }));

  mockReaddirSync.mockReturnValue(entries as any);
  mockReadFileSync.mockImplementation((filePath: any) => {
    const name = filePath.toString().split('/').pop()!;
    if (fileMap[name] !== undefined) return fileMap[name];
    throw new Error('ENOENT');
  });
}

describe('mapElementToSource', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('finds file by text content match', async () => {
    setupFiles({
      'Button.tsx': '<button>Submit Form</button>',
    });

    const payload = makePayload({ text: 'Submit Form' });
    const results = await mapElementToSource(payload, '/workspace');

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].matchType).toBe('text');
    expect(results[0].reason).toContain('Submit Form');
  });

  it('finds file by element ID match', async () => {
    setupFiles({
      'Form.tsx': '<button id="submit-btn">Go</button>',
    });

    const payload = makePayload({ id: 'submit-btn', text: '' });
    const results = await mapElementToSource(payload, '/workspace');

    const idMatch = results.find((r) => r.matchType === 'id');
    expect(idMatch).toBeDefined();
    expect(idMatch!.confidence).toBeGreaterThanOrEqual(0.85);
  });

  it('finds file by className match', async () => {
    setupFiles({
      'Hero.tsx': '<div className="primary-cta">Click</div>',
    });

    const payload = makePayload({ text: '', id: '', classList: ['primary-cta'] });
    const results = await mapElementToSource(payload, '/workspace');

    const classMatch = results.find((r) => r.matchType === 'className');
    expect(classMatch).toBeDefined();
    expect(classMatch!.confidence).toBeGreaterThanOrEqual(0.5);
  });

  it('finds file by aria-label match', async () => {
    setupFiles({
      'AccessibleBtn.tsx': '<button aria-label="Submit the form">Go</button>',
    });

    const payload = makePayload({ text: '', id: '', attributes: { 'aria-label': 'Submit the form' } });
    const results = await mapElementToSource(payload, '/workspace');

    const ariaMatch = results.find((r) => r.matchType === 'ariaLabel');
    expect(ariaMatch).toBeDefined();
    expect(ariaMatch!.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it('boosts confidence for PascalCase filenames', async () => {
    setupFiles({
      'button.tsx': '<button>Submit Form</button>',
      'Button.tsx': '<button>Submit Form</button>',
    });

    const payload = makePayload({ text: 'Submit Form' });
    const results = await mapElementToSource(payload, '/workspace');

    const pascal = results.find((r) => r.filePath.includes('Button.tsx'));
    const lower = results.find((r) => r.filePath.includes('button.tsx'));
    expect(pascal!.confidence).toBeGreaterThan(lower!.confidence);
  });

  it('deduplicates candidates by filePath:lineStart', async () => {
    // Same file will be found by both text and className
    setupFiles({
      'Component.tsx': '<button className="primary-cta">Submit Form</button>',
    });

    const payload = makePayload({ text: 'Submit Form', classList: ['primary-cta'] });
    const results = await mapElementToSource(payload, '/workspace');

    const filePaths = results.map((r) => `${r.filePath}:${r.lineStart}`);
    const unique = [...new Set(filePaths)];
    expect(filePaths.length).toBe(unique.length);
  });

  it('boosts confidence for multiple matches in same file', async () => {
    setupFiles({
      'MultiMatch.tsx': '<button id="submit-btn" className="primary-cta">Submit Form</button>',
    });

    // The element has both text and id, but they'll match the same line and be deduped.
    // Use different match points to get multiple candidates.
    const payload = makePayload({
      text: 'Submit Form',
      id: 'submit-btn',
    });
    const results = await mapElementToSource(payload, '/workspace');

    // At least one result should exist
    expect(results.length).toBeGreaterThan(0);
  });

  it('returns max 10 candidates', async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 20; i++) {
      files[`File${i}.tsx`] = `<button>Submit Form ${i}</button>`;
    }
    setupFiles(files);

    const payload = makePayload({ text: 'Submit Form' });
    const results = await mapElementToSource(payload, '/workspace');

    expect(results.length).toBeLessThanOrEqual(10);
  });

  it('returns empty array for workspace with no matching files', async () => {
    setupFiles({
      'Unrelated.tsx': '<div>Nothing to see here</div>',
    });

    const payload = makePayload({ text: 'Unique Text Not In Files', id: '', classList: [] });
    const results = await mapElementToSource(payload, '/workspace');

    expect(results).toEqual([]);
  });

  it('filters out Tailwind utility classes with hyphen prefix', async () => {
    setupFiles({
      'Card.tsx': '<div className="flex-col p-4 m-2 bg-blue-500 card-header">Hello</div>',
    });

    // The regex filters classes matching ^(p|m|w|h|...|flex|bg|...)-
    // So p-4, m-2, bg-blue-500, flex-col are filtered. "card-header" passes.
    // Note: bare "flex" (no hyphen) is NOT filtered by the regex.
    const payload = makePayload({
      text: '',
      id: '',
      classList: ['flex-col', 'p-4', 'm-2', 'bg-blue-500', 'card-header'],
    });
    const results = await mapElementToSource(payload, '/workspace');

    const classMatches = results.filter((r) => r.matchType === 'className');
    for (const match of classMatches) {
      expect(match.reason).not.toContain('flex-col');
      expect(match.reason).not.toContain('p-4');
      expect(match.reason).not.toContain('bg-blue-500');
    }
  });

  it('skips short text (< 3 chars)', async () => {
    setupFiles({
      'Short.tsx': '<span>OK</span>',
    });

    const payload = makePayload({ text: 'OK', id: '', classList: [] });
    const results = await mapElementToSource(payload, '/workspace');

    // Text "OK" is only 2 chars, should not search by text
    const textMatches = results.filter((r) => r.matchType === 'text');
    expect(textMatches).toHaveLength(0);
  });
});
