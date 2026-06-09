import { FieldValue, Timestamp, type Firestore } from "firebase-admin/firestore";

import { savedItemSchema, type SavedItem } from "../schemas/coreSchemas.js";
import { assertWorkspaceScoped, snapshotToData, workspaceCollection } from "./firestoreRepository.js";

export class SavedItemRepository {
  constructor(private readonly db: Firestore) {}

  private collection(workspaceId: string) {
    return workspaceCollection(this.db, workspaceId, "savedItems");
  }

  async create(workspaceId: string, data: Omit<SavedItem, "createdAt" | "updatedAt">): Promise<SavedItem> {
    const now = Timestamp.now();
    const full: SavedItem = {
      ...data,
      createdAt: now,
      updatedAt: now,
    };
    savedItemSchema.parse(full);
    assertWorkspaceScoped(full, workspaceId);
    await this.collection(workspaceId).doc(full.id).set(full);
    return full;
  }

  async get(workspaceId: string, savedItemId: string): Promise<SavedItem | null> {
    const snapshot = await this.collection(workspaceId).doc(savedItemId).get();
    if (!snapshot.exists) return null;
    const savedItem = savedItemSchema.parse({ id: snapshot.id, ...snapshot.data() });
    assertWorkspaceScoped(savedItem, workspaceId);
    return savedItem;
  }

  async list(workspaceId: string, limit = 100): Promise<SavedItem[]> {
    const snapshot = await this.collection(workspaceId)
      .orderBy("updatedAt", "desc")
      .limit(limit)
      .get();

    return snapshot.docs.map((doc) => {
      const savedItem = snapshotToData(doc, savedItemSchema);
      assertWorkspaceScoped(savedItem, workspaceId);
      return savedItem;
    });
  }

  async findByAssistantMessage(
    workspaceId: string,
    sessionId: string,
    assistantMessageId: string,
  ): Promise<SavedItem | null> {
    const snapshot = await this.collection(workspaceId)
      .where("sourceType", "==", "command_response")
      .where("sourceSessionId", "==", sessionId)
      .where("sourceAssistantMessageId", "==", assistantMessageId)
      .limit(1)
      .get();

    if (snapshot.empty) return null;

    const savedItem = snapshotToData(snapshot.docs[0], savedItemSchema);
    assertWorkspaceScoped(savedItem, workspaceId);
    return savedItem;
  }

  async findByPromotedArtifactId(workspaceId: string, artifactId: string): Promise<SavedItem[]> {
    const snapshot = await this.collection(workspaceId)
      .where("promotedArtifactId", "==", artifactId)
      .get();

    return snapshot.docs.map((doc) => {
      const savedItem = snapshotToData(doc, savedItemSchema);
      assertWorkspaceScoped(savedItem, workspaceId);
      return savedItem;
    });
  }

  async update(
    workspaceId: string,
    savedItemId: string,
    updates: Partial<
      Pick<SavedItem, "title" | "previewText" | "contentText" | "responseJson" | "mode" | "promotedArtifactId">
    >,
  ): Promise<void> {
    const normalizedUpdates = Object.fromEntries(
      Object.entries(updates).map(([key, value]) => [key, value === undefined ? FieldValue.delete() : value]),
    );
    await this.collection(workspaceId).doc(savedItemId).update({
      ...normalizedUpdates,
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  async delete(workspaceId: string, savedItemId: string): Promise<void> {
    await this.collection(workspaceId).doc(savedItemId).delete();
  }
}
