import type { ElementSelectedPayload } from './types.js';

export class SelectionStore {
  private buffer: ElementSelectedPayload[] = [];
  private maxSize: number;

  constructor(maxSize: number = 50) {
    this.maxSize = maxSize;
  }

  push(payload: ElementSelectedPayload): void {
    this.buffer.push(payload);
    if (this.buffer.length > this.maxSize) {
      this.buffer.shift();
    }
  }

  latest(): ElementSelectedPayload | null {
    return this.buffer.length > 0 ? this.buffer[this.buffer.length - 1] : null;
  }

  history(limit: number = 10): ElementSelectedPayload[] {
    return this.buffer.slice(-limit).reverse();
  }

  count(): number {
    return this.buffer.length;
  }

  getByCorrelationId(id: string): ElementSelectedPayload | undefined {
    return this.buffer.find((p) => p.correlationId === id);
  }

  clear(): void {
    this.buffer = [];
  }
}
