import { randomUUID } from "node:crypto";

import type { Response } from "express";

import { logger } from "../observability/logger.js";
import { eventBus, type SseEventEnvelope } from "./eventBus.js";

type SseConnection = {
  id: string;
  res: Response;
  workspaceId: string;
  unsubscribeFns: Array<() => void>;
  heartbeatTimer: ReturnType<typeof setInterval>;
};

class SseManager {
  private readonly connections = new Map<string, SseConnection>();

  /**
   * Register an SSE connection. Sets required headers, starts heartbeat,
   * subscribes to the given channels, and deregisters automatically on close.
   */
  register(res: Response, workspaceId: string, channels: string[]): string {
    const id = randomUUID();

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    // Disable nginx buffering so events flush immediately
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    // Confirm connection to client
    res.write(`event: connected\ndata: ${JSON.stringify({ connectionId: id })}\n\n`);

    // Keepalive ping every 25 s — prevents proxies from closing idle connections
    const heartbeatTimer = setInterval(() => {
      try {
        res.write(`:ping\n\n`);
      } catch {
        this.deregister(id);
      }
    }, 25_000);

    const unsubscribeFns = channels.map((channel) =>
      eventBus.subscribe(channel, (envelope: SseEventEnvelope) => {
        this.send(res, envelope);
      }),
    );

    this.connections.set(id, { id, res, workspaceId, unsubscribeFns, heartbeatTimer });

    res.on("close", () => this.deregister(id));

    logger.debug("SSE connection registered", { connectionId: id, workspaceId, channels });
    return id;
  }

  deregister(connectionId: string): void {
    const conn = this.connections.get(connectionId);
    if (!conn) return;
    clearInterval(conn.heartbeatTimer);
    conn.unsubscribeFns.forEach((fn) => fn());
    this.connections.delete(connectionId);
    logger.debug("SSE connection deregistered", { connectionId, workspaceId: conn.workspaceId });
  }

  /** Close every open connection — called on SIGTERM for graceful shutdown. */
  closeAll(): void {
    const count = this.connections.size;
    for (const conn of this.connections.values()) {
      clearInterval(conn.heartbeatTimer);
      conn.unsubscribeFns.forEach((fn) => fn());
      try { conn.res.end(); } catch { /* already closed */ }
    }
    this.connections.clear();
    logger.info("SSE: all connections closed on shutdown", { count });
  }

  get connectionCount(): number {
    return this.connections.size;
  }

  private send(res: Response, envelope: SseEventEnvelope): void {
    try {
      res.write(`id: ${envelope.id}\nevent: ${envelope.event}\ndata: ${JSON.stringify(envelope.data)}\n\n`);
    } catch {
      // connection closed between heartbeat check and write — deregister happens via 'close' event
    }
  }
}

export const sseManager = new SseManager();
