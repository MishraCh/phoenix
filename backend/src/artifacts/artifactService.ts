import { createHash } from "node:crypto";

import { Timestamp, type Firestore } from "firebase-admin/firestore";

import { ActivityService } from "../activity/activityService.js";
import {
  getCachedArtifacts,
  invalidateCachedArtifacts,
  invalidateCachedDashboardSummary,
  setCachedArtifacts,
} from "../cache/requestStateCache.js";
import { artifactSchema, sourceRefSchema, type Artifact, type Workspace } from "../schemas/coreSchemas.js";
import { SavedItemRepository } from "../repositories/savedItemRepository.js";
import { RetrievalService } from "../services/retrievalService.js";
import { IndexingLifecycleService } from "../ai/indexing/indexingLifecycleService.js";
import { ApiError } from "../utils/apiError.js";

type ApiArtifactType = "report" | "draft" | "summary" | "data" | "document";

type CreateArtifactInput = {
  workspace: Workspace;
  userId: string;
  title: string;
  artifactType: ApiArtifactType;
  content: string;
  sourceRefs: unknown[];
  inputHash?: string;
  creationSource?: Artifact["creationSource"];
  sourceSessionId?: string;
  sourceAssistantMessageId?: string;
  generatedByAgentId?: string;
  workflowId?: string;
  workflowRunId?: string;
};

type ListArtifactsOptions = {
  artifactType?: string;
  agentId?: string;
  workflowId?: string;
  limit?: number;
};

const apiToInternalArtifactType = {
  report: "research_report",
  draft: "draft",
  summary: "brief",
  data: "data",
  document: "document",
} as const;

function internalToApiArtifactType(type: string) {
  if (type === "research_report") {
    return "report";
  }

  if (type === "brief" || type === "meeting_prep" || type === "saved_insight") {
    return "summary";
  }

  if (type === "draft") {
    return "draft";
  }

  if (type === "data") {
    return "data";
  }

  if (type === "document") {
    return "document";
  }

  return type;
}

function hashContent(content: string) {
  return createHash("sha256").update(content.trim()).digest("hex");
}

function serializeListArtifact(artifact: ReturnType<typeof artifactSchema.parse>) {
  return {
    id: artifact.id,
    title: artifact.title,
    artifactType: internalToApiArtifactType(artifact.type),
    summary: artifact.textContent?.slice(0, 240) ?? null,
    createdAt: artifact.createdAt.toDate().toISOString(),
  };
}

export class ArtifactService {
  private readonly activityService: ActivityService;

  constructor(private readonly db: Firestore) {
    this.activityService = new ActivityService(db);
  }

  private collection(workspaceId: string) {
    return this.db.collection("workspaces").doc(workspaceId).collection("artifacts");
  }

  async createArtifact(input: CreateArtifactInput) {
    const artifactRef = this.collection(input.workspace.id).doc();
    const now = Timestamp.now();
    const sourceRefs = input.sourceRefs.map((sourceRef) => sourceRefSchema.parse(sourceRef));
    const sourceHashes = sourceRefs.map((sourceRef) => hashContent(`${sourceRef.sourceType}:${sourceRef.sourceId}`));
    const artifact = {
      id: artifactRef.id,
      workspaceId: input.workspace.id,
      type: apiToInternalArtifactType[input.artifactType],
      title: input.title,
      status: "saved" as const,
      content: {
        body: input.content,
      },
      textContent: input.content,
      sourceRefs,
      inputHash: input.inputHash ?? hashContent(input.content),
      sourceHashes,
      generatedByAgentId: input.generatedByAgentId,
      workflowId: input.workflowId,
      workflowRunId: input.workflowRunId,
      creationSource: input.creationSource ?? "manual",
      sourceSessionId: input.sourceSessionId,
      sourceAssistantMessageId: input.sourceAssistantMessageId,
      createdBy: input.userId,
      createdAt: now,
      updatedAt: now,
    };

    artifactSchema.parse(artifact);
    await artifactRef.set(artifact);
    invalidateCachedArtifacts(input.workspace.id);
    invalidateCachedDashboardSummary(input.workspace.id);
    // Legacy embedding path — keeps inline artifact.embedding field working
    void new RetrievalService(this.db).indexArtifact(
      input.workspace.id,
      artifactRef.id,
      input.title,
      input.content,
    );
    // Phase 2: parallel dual-write to unified IndexedSources store
    void new IndexingLifecycleService(this.db).onArtifactCreated({
      workspaceId: input.workspace.id,
      artifactId: artifactRef.id,
      title: input.title,
      content: input.content,
      artifactType: input.artifactType,
      createdBy: input.userId,
    });
    await this.activityService.createEvent({
      workspaceId: input.workspace.id,
      type: "artifact.created",
      title: `Artifact saved: ${input.title}`,
      actorType: "user",
      actorId: input.userId,
      related: { artifactId: artifactRef.id },
      metadata: { artifactType: input.artifactType, creationSource: input.creationSource ?? "manual" },
    });

    return artifact;
  }

  async listArtifacts(workspace: Workspace, options: ListArtifactsOptions) {
    let allArtifacts: Artifact[];
    const cached = getCachedArtifacts(workspace.id);
    if (cached) {
      allArtifacts = cached;
    } else {
      const snapshot = await this.collection(workspace.id).limit(100).get();
      allArtifacts = snapshot.docs.map((doc) => artifactSchema.parse({ id: doc.id, ...doc.data() }));
      setCachedArtifacts(workspace.id, allArtifacts);
    }

    const internalFilter =
      options.artifactType && options.artifactType in apiToInternalArtifactType
        ? apiToInternalArtifactType[options.artifactType as ApiArtifactType]
        : options.artifactType;

    return allArtifacts
      .filter((artifact) => (internalFilter ? artifact.type === internalFilter : true))
      .filter((artifact) => (options.agentId ? artifact.generatedByAgentId === options.agentId : true))
      .filter((artifact) => (options.workflowId ? artifact.workflowId === options.workflowId : true))
      .sort((left, right) => right.createdAt.toMillis() - left.createdAt.toMillis())
      .slice(0, options.limit ?? 50)
      .map(serializeListArtifact);
  }

  async getArtifact(workspace: Workspace, artifactId: string) {
    const snapshot = await this.collection(workspace.id).doc(artifactId).get();

    if (!snapshot.exists) {
      throw new ApiError({
        code: "NOT_FOUND",
        message: "Artifact not found.",
        status: 404,
      });
    }

    return artifactSchema.parse({ id: snapshot.id, ...snapshot.data() });
  }

  serializeArtifact(artifact: ReturnType<typeof artifactSchema.parse>) {
    return {
      id: artifact.id,
      title: artifact.title,
      artifactType: internalToApiArtifactType(artifact.type),
      status: artifact.status,
      content: artifact.textContent ?? "",
      sourceRefs: artifact.sourceRefs,
      inputHash: artifact.inputHash ?? null,
      sourceHashes: artifact.sourceHashes ?? [],
      createdAt: artifact.createdAt.toDate().toISOString(),
      updatedAt: artifact.updatedAt.toDate().toISOString(),
    };
  }

  async deleteArtifact(workspace: Workspace, artifactId: string): Promise<void> {
    const snapshot = await this.collection(workspace.id).doc(artifactId).get();
    if (!snapshot.exists) {
      throw new ApiError({
        code: "NOT_FOUND",
        message: "Artifact not found.",
        status: 404,
      });
    }

    const artifact = artifactSchema.parse({ id: snapshot.id, ...snapshot.data() });
    await this.collection(workspace.id).doc(artifactId).delete();

    // Phase 2: purge from IndexedSources
    void new IndexingLifecycleService(this.db).onArtifactDeleted(workspace.id, artifactId);

    const savedItemRepo = new SavedItemRepository(this.db);
    const linkedSavedItems = await savedItemRepo.findByPromotedArtifactId(workspace.id, artifactId);
    await Promise.all(
      linkedSavedItems.map((savedItem) =>
        savedItemRepo.update(workspace.id, savedItem.id, { promotedArtifactId: undefined }),
      ),
    );

    invalidateCachedArtifacts(workspace.id);
    invalidateCachedDashboardSummary(workspace.id);
    await this.activityService.createEvent({
      workspaceId: workspace.id,
      type: "artifact.deleted",
      title: `Artifact deleted: ${artifact.title}`,
      actorType: "user",
      related: { artifactId },
      metadata: {
        artifactType: internalToApiArtifactType(artifact.type),
        creationSource: artifact.creationSource,
      },
    });
  }
}
