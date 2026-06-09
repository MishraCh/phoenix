import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";

export type SseEventData = {
  workspaceId: string;
  timestamp: string;
  [key: string]: unknown;
};

export type SseEventEnvelope = {
  event: string;
  id: string;
  data: SseEventData;
};

/**
 * Abstract event bus interface — LocalEventBus now, Redis pub/sub later.
 * Consumers always depend on this interface, never on the concrete class.
 */
export interface IEventBus {
  publish(channel: string, envelope: SseEventEnvelope): void;
  subscribe(channel: string, handler: (envelope: SseEventEnvelope) => void): () => void;
}

class LocalEventBus implements IEventBus {
  private readonly emitter = new EventEmitter();

  constructor() {
    // Each workspace/session/run can have many SSE connections
    this.emitter.setMaxListeners(500);
  }

  publish(channel: string, envelope: SseEventEnvelope): void {
    this.emitter.emit(channel, envelope);
  }

  subscribe(channel: string, handler: (envelope: SseEventEnvelope) => void): () => void {
    this.emitter.on(channel, handler);
    return () => this.emitter.off(channel, handler);
  }
}

export const eventBus: IEventBus = new LocalEventBus();

/**
 * Publish a named event to one or more channels simultaneously.
 * Automatically stamps a unique ID and ISO timestamp.
 */
export function publishEvent(
  channels: string[],
  event: string,
  data: SseEventData,
): void {
  const envelope: SseEventEnvelope = {
    event,
    id: randomUUID(),
    data: { ...data, timestamp: data.timestamp ?? new Date().toISOString() },
  };
  for (const channel of channels) {
    eventBus.publish(channel, envelope);
  }
}
