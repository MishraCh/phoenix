import { Timestamp, type Firestore } from "firebase-admin/firestore";

import { ActivityService } from "../activity/activityService.js";
import { contextBundleSchema, sourceRefSchema, type ContextBundle, type SourceRef, type Workspace } from "../schemas/coreSchemas.js";
import { ApiError } from "../utils/apiError.js";
import { contextInputHash, sourceHash } from "./sourceHash.js";

type BuildContextInput = {
  workspace: Workspace;
  userId: string;
  key: string;
  purpose: string;
  sourceRefs?: unknown[];
  payload?: Record<string, unknown>;
  ttlMinutes?: number;
  sourceRevisions?: Record<string, string>;
  providerConfigurationHash?: string;
  connectionGenerationId?: string;
};

function collection(db: Firestore, workspaceId: string) {
  return db.collection("workspaces").doc(workspaceId).collection("contextBundles");
}

function inferFreshness(sourceRefs: SourceRef[]) {
  if (sourceRefs.length === 0) {
    return "missing" as const;
  }

  return sourceRefs.some((sourceRef) => (sourceRef.confidence ?? 1) < 0.6) ? "partial" as const : "fresh" as const;
}

function missingSourcesFor(sourceRefs: SourceRef[]) {
  const presentTypes = new Set(sourceRefs.map((sourceRef) => sourceRef.sourceType));
  const missing = [];

  if (!presentTypes.has("integration")) {
    missing.push("Connected integrations");
  }

  if (!presentTypes.has("memory")) {
    missing.push("Workspace/company memory");
  }

  if (sourceRefs.length === 0) {
    missing.push("Recent artifacts or synced source records");
  }

  return missing;
}

function serializeBundle(bundle: ContextBundle) {
  return {
    id: bundle.id,
    key: bundle.key,
    purpose: bundle.purpose,
    freshness: bundle.freshness,
    missingSources: bundle.missingSources ?? [],
    sourceRefs: bundle.sourceRefs.map((sourceRef) => ({
      sourceType: sourceRef.sourceType,
      sourceId: sourceRef.sourceId,
      title: sourceRef.title ?? null,
      url: sourceRef.url ?? null,
      confidence: sourceRef.confidence ?? null,
    })),
    inputHash: bundle.inputHash,
    expiresAt: bundle.expiresAt.toDate().toISOString(),
    createdAt: bundle.createdAt.toDate().toISOString(),
    updatedAt: bundle.updatedAt.toDate().toISOString(),
  };
}

export class ContextService {
  private readonly activityService: ActivityService;

  constructor(private readonly db: Firestore) {
    this.activityService = new ActivityService(db);
  }

  async getBundle(workspace: Workspace, bundleId: string) {
    const snapshot = await collection(this.db, workspace.id).doc(bundleId).get();

    if (!snapshot.exists) {
      throw new ApiError({
        code: "NOT_FOUND",
        message: "Context bundle not found.",
        status: 404,
      });
    }

    return contextBundleSchema.parse({ id: snapshot.id, ...snapshot.data() });
  }

  async listBundles(workspace: Workspace, limit = 25) {
    const snapshot = await collection(this.db, workspace.id).limit(100).get();

    return snapshot.docs
      .map((doc) => contextBundleSchema.parse({ id: doc.id, ...doc.data() }))
      .sort((left, right) => right.updatedAt.toMillis() - left.updatedAt.toMillis())
      .slice(0, limit)
      .map(serializeBundle);
  }

  async buildOrReuseBundle(input: BuildContextInput) {
    const sourceRefs = (input.sourceRefs ?? []).map((sourceRef) => sourceRefSchema.parse(sourceRef));
    const inputHash = contextInputHash({
      key: input.key,
      purpose: input.purpose,
      sourceRefs,
      payload: input.payload,
      sourceRevisions: input.sourceRevisions ?? {},
      providerConfigurationHash: input.providerConfigurationHash ?? null,
      connectionGenerationId: input.connectionGenerationId ?? null,
    });
    const now = Timestamp.now();
    const snapshot = await collection(this.db, input.workspace.id)
      .where("key", "==", input.key)
      .where("inputHash", "==", inputHash)
      .limit(10)
      .get();
    const reusable = snapshot.docs
      .map((doc) => contextBundleSchema.parse({ id: doc.id, ...doc.data() }))
      .find((bundle) => bundle.expiresAt.toMillis() > now.toMillis());

    if (reusable) {
      return { bundle: reusable, reused: true };
    }

    const bundleRef = collection(this.db, input.workspace.id).doc();
    const freshness = inferFreshness(sourceRefs);
    const missingSources = missingSourcesFor(sourceRefs);
    const expiresAt = Timestamp.fromMillis(now.toMillis() + (input.ttlMinutes ?? 15) * 60 * 1000);
    const bundle = contextBundleSchema.parse({
      id: bundleRef.id,
      workspaceId: input.workspace.id,
      key: input.key,
      purpose: input.purpose,
      inputHash,
      sourceRefs,
      sourceHashes: sourceRefs.map((sourceRef) => sourceHash(sourceRef.sourceType, sourceRef.sourceId)),
      content: {
        purpose: input.purpose,
        payload: input.payload ?? {},
        sourceCount: sourceRefs.length,
      },
      freshness,
      missingSources,
      cacheVersion: "context-bundle.v2",
      sourceRevisions: input.sourceRevisions ?? {},
      providerConfigurationHash: input.providerConfigurationHash,
      connectionGenerationId: input.connectionGenerationId,
      expiresAt,
      createdAt: now,
      updatedAt: now,
    });

    await bundleRef.set(bundle);
    await this.activityService.createEvent({
      workspaceId: input.workspace.id,
      type: "context.bundle_created",
      title: `Context bundle created: ${input.key}`,
      actorType: "user",
      actorId: input.userId,
      related: {},
      metadata: {
        freshness,
        missingSources,
      },
    });

    return { bundle, reused: false };
  }

  serializeBundle(bundle: ContextBundle) {
    return serializeBundle(bundle);
  }
}
