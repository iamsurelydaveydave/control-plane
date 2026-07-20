/**
 * In-process log broker for provisioning operations.
 *
 * Bridges the provisioner's `onLog` callback to SSE connections:
 *   provisioner.onLog → logBroker.addLine()  →  EventEmitter
 *   SSE handler       ← logBroker.on(...)    ←  EventEmitter
 *
 * Each database has its own event channel: `log:<databaseId>`
 * A rolling buffer (last 2 000 lines) is kept so clients that connect
 * mid-provisioning receive the full history before live updates.
 */

import { EventEmitter } from "events";

export interface TLogEvent {
  line?: string;           // a new log line
  done?: boolean;          // provisioning finished
  status?: "success" | "failed";
}

const MAX_BUFFER = 2000;
// How long to keep the buffer after provisioning completes (ms).
// Allows late-joining clients (e.g. page refresh) to see the final output.
const BUFFER_TTL_MS = 10 * 60 * 1000; // 10 minutes

class LogBroker extends EventEmitter {
  private buffers  = new Map<string, string[]>();
  private timers   = new Map<string, ReturnType<typeof setTimeout>>();

  /** Append a log line and broadcast it to listeners. */
  addLine(databaseId: string, line: string): void {
    if (!this.buffers.has(databaseId)) {
      this.buffers.set(databaseId, []);
    }

    const buf = this.buffers.get(databaseId)!;
    buf.push(line);

    // Keep buffer bounded
    if (buf.length > MAX_BUFFER) {
      buf.splice(0, buf.length - MAX_BUFFER);
    }

    this.emit(`log:${databaseId}`, { line } as TLogEvent);
  }

  /** Signal that provisioning has finished and schedule buffer cleanup. */
  complete(databaseId: string, status: "success" | "failed"): void {
    this.emit(`log:${databaseId}`, { done: true, status } as TLogEvent);

    // Clear any existing cleanup timer and set a new one
    const existing = this.timers.get(databaseId);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      this.buffers.delete(databaseId);
      this.timers.delete(databaseId);
    }, BUFFER_TTL_MS);

    this.timers.set(databaseId, timer);
  }

  /** Return buffered lines for a database (for catch-up on connect). */
  getBuffer(databaseId: string): string[] {
    return this.buffers.get(databaseId) ?? [];
  }

  /** True when there is an active buffer (i.e. provisioning happened recently). */
  hasBuffer(databaseId: string): boolean {
    return this.buffers.has(databaseId);
  }
}

// Singleton — shared across the entire process
export const logBroker = new LogBroker();
// Allow many concurrent SSE listeners per database
logBroker.setMaxListeners(100);
