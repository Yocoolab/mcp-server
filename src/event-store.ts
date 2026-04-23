import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { ActivityEvent } from './activity-types.js';
import { MAX_RING_BUFFER_SIZE } from './activity-constants.js';

const DATA_DIR = path.join(os.homedir(), '.yocoolab-mcp');
const EVENTS_FILE = path.join(DATA_DIR, 'events.jsonl');
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB rotation threshold
const KEEP_LINES_ON_ROTATE = 5000;

export class ActivityEventStore {
  private buffer: ActivityEvent[] = [];
  private maxSize: number;
  private writeStream: fs.WriteStream | null = null;

  constructor(maxSize: number = MAX_RING_BUFFER_SIZE) {
    this.maxSize = maxSize;
    this.ensureDataDir();
    this.writeStream = fs.createWriteStream(EVENTS_FILE, { flags: 'a' });
  }

  private ensureDataDir(): void {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
  }

  push(event: ActivityEvent): void {
    this.buffer.push(event);
    if (this.buffer.length > this.maxSize) {
      this.buffer.shift();
    }
    // Append to JSONL for persistence
    try {
      this.writeStream?.write(JSON.stringify(event) + '\n');
    } catch {
      // Silent — don't block event processing for disk errors
    }
  }

  recent(limit: number = 200): ActivityEvent[] {
    const start = Math.max(0, this.buffer.length - limit);
    return this.buffer.slice(start);
  }

  count(): number {
    return this.buffer.length;
  }

  loadFromDisk(): void {
    try {
      if (!fs.existsSync(EVENTS_FILE)) return;

      // Rotate if too large
      const stat = fs.statSync(EVENTS_FILE);
      if (stat.size > MAX_FILE_SIZE) {
        this.rotateFile();
      }

      const content = fs.readFileSync(EVENTS_FILE, 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);
      // Load last maxSize events
      const start = Math.max(0, lines.length - this.maxSize);
      for (let i = start; i < lines.length; i++) {
        try {
          this.buffer.push(JSON.parse(lines[i]));
        } catch {
          // Skip corrupt lines
        }
      }
      process.stderr.write(`[yocoolab] Loaded ${this.buffer.length} events from disk\n`);
    } catch {
      // Fresh start if file unreadable
    }
  }

  private rotateFile(): void {
    try {
      const content = fs.readFileSync(EVENTS_FILE, 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);
      const kept = lines.slice(-KEEP_LINES_ON_ROTATE);
      fs.writeFileSync(EVENTS_FILE, kept.join('\n') + '\n');
      process.stderr.write(`[yocoolab] Rotated events file: kept last ${kept.length} of ${lines.length} lines\n`);
    } catch {
      // If rotation fails, continue with existing file
    }
  }

  close(): void {
    this.writeStream?.end();
    this.writeStream = null;
  }
}
