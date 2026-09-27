import { randomBytes } from "node:crypto";

import type { EngineEvent } from "@/lib/engine-events";

/** Recent events kept for a drawer that connects (or reconnects) later. */
const BUFFER_SIZE = 500;

export type EngineEventInput = Omit<EngineEvent, "id" | "at">;
export type EmitEngineEvent = (event: EngineEventInput) => void;

/**
 * In-process event bus behind the dashboard's live log: the listener, verifier, webhook dispatcher and routes emit
 * here, and GET /api/dev/events streams it. Per process: with several instances (the postgres store), a drawer
 * sees the events of the instance its stream landed on.
 */
export class EngineEvents {
  readonly bootId = randomBytes(4).toString("hex");
  private sequence = 0;
  private readonly buffer: EngineEvent[] = [];
  private readonly listeners = new Set<(event: EngineEvent) => void>();

  readonly emit: EmitEngineEvent = (input) => {
    const event: EngineEvent = { id: `${this.bootId}:${++this.sequence}`, at: Date.now(), ...input };
    this.buffer.push(event);
    if (this.buffer.length > BUFFER_SIZE) this.buffer.shift();
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // A broken stream mustn't stop the others, or the engine.
      }
    }
  };

  /** Buffered events after `lastId`; all of them when it's missing or from before a restart. */
  since(lastId: string | null): EngineEvent[] {
    const [boot, sequence] = lastId?.split(":") ?? [];
    if (boot !== this.bootId || !sequence) return [...this.buffer];
    return this.buffer.filter((event) => Number(event.id.split(":")[1]) > Number(sequence));
  }

  subscribe(listener: (event: EngineEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
