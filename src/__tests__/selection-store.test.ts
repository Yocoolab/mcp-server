import { describe, it, expect, beforeEach } from 'vitest';
import { SelectionStore } from '../selection-store.js';
import type { ElementSelectedPayload } from '../types.js';

function makePayload(overrides: Partial<ElementSelectedPayload> = {}): ElementSelectedPayload {
  return {
    type: 'ELEMENT_SELECTED',
    timestamp: Date.now(),
    correlationId: `corr-${Math.random().toString(36).slice(2)}`,
    page: { url: 'https://example.com', title: 'Test', viewport: { w: 1920, h: 1080 }, devicePixelRatio: 1 },
    element: {
      selector: 'button.submit',
      tag: 'BUTTON',
      id: 'submit-btn',
      classList: ['submit', 'primary'],
      text: 'Submit',
      attributes: {},
      domPath: ['HTML', 'BODY', 'FORM', 'BUTTON'],
      boundingBox: { x: 100, y: 200, w: 120, h: 40 },
    },
    styles: {
      computed: {
        color: 'rgb(255,255,255)',
        backgroundColor: 'rgb(0,0,255)',
        fontSize: '16px',
        fontFamily: 'sans-serif',
        fontWeight: '600',
        padding: '8px 16px',
        margin: '0px',
        border: 'none',
        borderRadius: '4px',
        display: 'inline-flex',
        position: 'relative',
      },
    },
    hints: { frameworkGuess: 'react', devServer: 'vite' },
    ...overrides,
  };
}

describe('SelectionStore', () => {
  let store: SelectionStore;

  beforeEach(() => {
    store = new SelectionStore();
  });

  it('push() and latest() returns the pushed payload', () => {
    const payload = makePayload();
    store.push(payload);
    expect(store.latest()).toBe(payload);
  });

  it('latest() returns null on empty store', () => {
    expect(store.latest()).toBeNull();
  });

  it('push() respects maxSize and evicts oldest', () => {
    const smallStore = new SelectionStore(3);
    const p1 = makePayload({ correlationId: 'first' });
    const p2 = makePayload({ correlationId: 'second' });
    const p3 = makePayload({ correlationId: 'third' });
    const p4 = makePayload({ correlationId: 'fourth' });

    smallStore.push(p1);
    smallStore.push(p2);
    smallStore.push(p3);
    expect(smallStore.count()).toBe(3);

    smallStore.push(p4);
    expect(smallStore.count()).toBe(3);
    expect(smallStore.getByCorrelationId('first')).toBeUndefined();
    expect(smallStore.latest()!.correlationId).toBe('fourth');
  });

  it('history() returns items in reverse chronological order', () => {
    const payloads = Array.from({ length: 5 }, (_, i) =>
      makePayload({ correlationId: `id-${i}` })
    );
    payloads.forEach((p) => store.push(p));

    const history = store.history(3);
    expect(history).toHaveLength(3);
    expect(history[0].correlationId).toBe('id-4');
    expect(history[1].correlationId).toBe('id-3');
    expect(history[2].correlationId).toBe('id-2');
  });

  it('history() defaults to 10 items', () => {
    for (let i = 0; i < 15; i++) {
      store.push(makePayload({ correlationId: `id-${i}` }));
    }
    const history = store.history();
    expect(history).toHaveLength(10);
  });

  it('getByCorrelationId() finds matching payload', () => {
    const target = makePayload({ correlationId: 'target-id' });
    store.push(makePayload());
    store.push(target);
    store.push(makePayload());

    expect(store.getByCorrelationId('target-id')).toBe(target);
  });

  it('getByCorrelationId() returns undefined for missing ID', () => {
    store.push(makePayload());
    expect(store.getByCorrelationId('nonexistent')).toBeUndefined();
  });

  it('count() tracks count correctly', () => {
    expect(store.count()).toBe(0);
    store.push(makePayload());
    expect(store.count()).toBe(1);
    store.push(makePayload());
    expect(store.count()).toBe(2);
  });

  it('clear() empties the store', () => {
    store.push(makePayload());
    store.push(makePayload());
    expect(store.count()).toBe(2);

    store.clear();
    expect(store.count()).toBe(0);
    expect(store.latest()).toBeNull();
  });
});
