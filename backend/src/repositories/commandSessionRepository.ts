import { FieldValue, Timestamp, type Firestore } from "firebase-admin/firestore";

import {
  getCachedCommandSessions,
  setCachedCommandSessions,
} from "../cache/requestStateCache.js";
import {
  commandSessionMessageSchema,
  commandSessionSchema,
  type CommandSession,
  type CommandSessionMessage,
} from "../schemas/coreSchemas.js";
import { assertWorkspaceScoped, snapshotToData, workspaceCollection } from "./firestoreRepository.js";

export class CommandSessionRepository {
  constructor(private readonly db: Firestore) {}

  private sessionCollection(workspaceId: string) {
    return workspaceCollection(this.db, workspaceId, "commandSessions");
  }

  private messageCollection(workspaceId: string, sessionId: string) {
    return this.sessionCollection(workspaceId).doc(sessionId).collection("messages");
  }

  async create(workspaceId: string, data: Omit<CommandSession, "createdAt" | "updatedAt">): Promise<CommandSession> {
    const now = Timestamp.now();
    const full: CommandSession = {
      ...data,
      createdAt: now,
      updatedAt: now,
    };
    assertWorkspaceScoped(full, workspaceId);
    await this.sessionCollection(workspaceId).doc(full.id).set(full);
    return full;
  }

  async get(workspaceId: string, sessionId: string): Promise<CommandSession | null> {
    const snapshot = await this.sessionCollection(workspaceId).doc(sessionId).get();
    if (!snapshot.exists) return null;
    const data = commandSessionSchema.parse({ id: snapshot.id, ...snapshot.data() });
    assertWorkspaceScoped(data, workspaceId);
    return data;
  }

  async update(
    workspaceId: string,
    sessionId: string,
    updates: Partial<
      Pick<
        CommandSession,
        | "status"
        | "pinned"
        | "bookmarked"
        | "lastMessagePreview"
        | "turnCount"
        | "artifactIds"
        | "sourceRefs"
        | "summary"
        | "compressedContext"
        | "summaryStatus"
        | "summaryAttempts"
        | "lastSummaryError"
        | "lastSummaryAttemptAt"
        | "sessionStateJson"
        | "sessionStateRevision"
      >
    >,
  ): Promise<void> {
    await this.sessionCollection(workspaceId).doc(sessionId).update({
      ...updates,
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  async list(workspaceId: string, limit = 30): Promise<CommandSession[]> {
    const cached = getCachedCommandSessions(workspaceId);
    if (cached) return cached.slice(0, limit);

    const snapshot = await this.sessionCollection(workspaceId)
      .orderBy("updatedAt", "desc")
      .limit(50)
      .get();
    const results = snapshot.docs.map((doc) => {
      const data = snapshotToData(doc, commandSessionSchema);
      assertWorkspaceScoped(data, workspaceId);
      return data;
    });
    setCachedCommandSessions(workspaceId, results);
    return results.slice(0, limit);
  }

  async appendMessage(
    workspaceId: string,
    sessionId: string,
    data: Omit<CommandSessionMessage, "createdAt">,
  ): Promise<CommandSessionMessage> {
    const now = Timestamp.now();
    const full: CommandSessionMessage = { ...data, createdAt: now };
    commandSessionMessageSchema.parse(full);
    await this.messageCollection(workspaceId, sessionId).doc(full.id).set(full);
    return full;
  }

  async getMessages(workspaceId: string, sessionId: string, limit = 50): Promise<CommandSessionMessage[]> {
    const snapshot = await this.messageCollection(workspaceId, sessionId)
      .orderBy("createdAt", "asc")
      .limit(limit)
      .get();
    return snapshot.docs.map((doc) => snapshotToData(doc, commandSessionMessageSchema));
  }

  async getMessage(workspaceId: string, sessionId: string, messageId: string): Promise<CommandSessionMessage | null> {
    const snapshot = await this.messageCollection(workspaceId, sessionId).doc(messageId).get();
    if (!snapshot.exists) return null;
    return commandSessionMessageSchema.parse({ id: snapshot.id, ...snapshot.data() });
  }

  async updateMessage(
    workspaceId: string,
    sessionId: string,
    messageId: string,
    updates: Partial<Pick<CommandSessionMessage, "artifactIds" | "starredByUserIds" | "savedItemId">>,
  ): Promise<void> {
    const normalizedUpdates = Object.fromEntries(
      Object.entries(updates).map(([key, value]) => [key, value === undefined ? FieldValue.delete() : value]),
    );
    await this.messageCollection(workspaceId, sessionId).doc(messageId).update(normalizedUpdates);
  }
}
