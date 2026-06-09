import type { Firestore } from "firebase-admin/firestore";
import type { ZodType } from "zod";

import {
  activityEventSchema,
  agentRunSchema,
  agentSchema,
  approvalSchema,
  artifactSchema,
  contextBundleSchema,
  integrationItemSchema,
  integrationSchema,
  inviteCodeSchema,
  jobLockSchema,
  notificationSchema,
  usageRecordSchema,
  type Workspace,
  workflowRunSchema,
  workflowSchema,
} from "../schemas/coreSchemas.js";
import { assertWorkspaceScoped, snapshotToData, workspaceCollection } from "./firestoreRepository.js";

type WorkspaceDocument = { id: string; workspaceId: string };

export class WorkspaceScopedRepository<T extends WorkspaceDocument> {
  constructor(
    private readonly db: Firestore,
    private readonly collectionName: string,
    private readonly schema: ZodType<T>,
  ) {}

  async get(workspaceId: string, id: string): Promise<T | null> {
    const snapshot = await workspaceCollection(this.db, workspaceId, this.collectionName).doc(id).get();

    if (!snapshot.exists) {
      return null;
    }

    const data = this.schema.parse({ id: snapshot.id, ...snapshot.data() });
    assertWorkspaceScoped(data, workspaceId);
    return data;
  }

  async create(workspaceId: string, data: T): Promise<string> {
    assertWorkspaceScoped(data, workspaceId);
    this.schema.parse(data);
    await workspaceCollection(this.db, workspaceId, this.collectionName).doc(data.id).set(data);
    return data.id;
  }

  async list(workspaceId: string, limit = 25): Promise<T[]> {
    const snapshot = await workspaceCollection(this.db, workspaceId, this.collectionName)
      .limit(limit)
      .get();

    return snapshot.docs.map((doc) => {
      const data = snapshotToData(doc, this.schema);
      assertWorkspaceScoped(data, workspaceId);
      return data;
    });
  }
}

export function createCoreRepositories(db: Firestore) {
  return {
    agents: new WorkspaceScopedRepository(db, "agents", agentSchema),
    agentRuns: new WorkspaceScopedRepository(db, "agentRuns", agentRunSchema),
    workflows: new WorkspaceScopedRepository(db, "workflows", workflowSchema),
    workflowRuns: new WorkspaceScopedRepository(db, "workflowRuns", workflowRunSchema),
    approvals: new WorkspaceScopedRepository(db, "approvals", approvalSchema),
    artifacts: new WorkspaceScopedRepository(db, "artifacts", artifactSchema),
    activityEvents: new WorkspaceScopedRepository(db, "activity", activityEventSchema),
    notifications: new WorkspaceScopedRepository(db, "notifications", notificationSchema),
    contextBundles: new WorkspaceScopedRepository(db, "contextBundles", contextBundleSchema),
    usageRecords: new WorkspaceScopedRepository(db, "usage", usageRecordSchema),
    jobLocks: new WorkspaceScopedRepository(db, "jobLocks", jobLockSchema),
    inviteCodes: new WorkspaceScopedRepository(db, "inviteCodes", inviteCodeSchema),
    integrations: new WorkspaceScopedRepository(db, "integrations", integrationSchema),
    integrationItems: new WorkspaceScopedRepository(db, "integrationItems", integrationItemSchema),
  };
}

export type WorkspaceRepositoryShape = Pick<Workspace, "id" | "name" | "plan">;
