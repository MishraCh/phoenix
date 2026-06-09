import { Timestamp, type Firestore } from "firebase-admin/firestore";

import { activityEventSchema, type Workspace } from "../schemas/coreSchemas.js";

type RelatedEntity = {
  agentRunId?: string;
  workflowId?: string;
  workflowRunId?: string;
  approvalId?: string;
  artifactId?: string;
  integrationId?: string;
  personId?: string;
};

export type CreateActivityEventInput = {
  workspaceId: string;
  type: string;
  title: string;
  description?: string;
  actorType: "user" | "agent" | "system";
  actorId?: string;
  related?: RelatedEntity;
  metadata?: Record<string, unknown>;
};

function inferEntity(related: RelatedEntity) {
  const entry = Object.entries(related).find(([, value]) => Boolean(value));

  if (!entry) {
    return { entityType: "workspace", entityId: null };
  }

  return {
    entityType: entry[0],
    entityId: entry[1] ?? null,
  };
}

function serializeActivityEvent(event: ReturnType<typeof activityEventSchema.parse>) {
  const { entityId, entityType } = inferEntity(event.related);

  return {
    id: event.id,
    eventType: event.type,
    summary: event.title,
    entityType,
    entityId: entityId ?? event.workspaceId,
    createdAt: event.createdAt.toDate().toISOString(),
  };
}

export class ActivityService {
  constructor(private readonly db: Firestore) {}

  async createEvent(input: CreateActivityEventInput) {
    const eventRef = this.db
      .collection("workspaces")
      .doc(input.workspaceId)
      .collection("activity")
      .doc();

    const event = {
      id: eventRef.id,
      workspaceId: input.workspaceId,
      type: input.type,
      title: input.title,
      description: input.description,
      actorType: input.actorType,
      actorId: input.actorId,
      related: input.related ?? {},
      metadata: input.metadata,
      createdAt: Timestamp.now(),
    };

    activityEventSchema.parse(event);
    await eventRef.set(event);
    return event;
  }

  async listEvents(workspace: Workspace, options: { limit?: number; entityType?: string; entityId?: string }) {
    let query = this.db
      .collection("workspaces")
      .doc(workspace.id)
      .collection("activity")
      .orderBy("createdAt", "desc")
      .limit(options.limit ?? 25);

    if (options.entityType && options.entityId) {
      query = query.where(`related.${options.entityType}`, "==", options.entityId);
    }

    const snapshot = await query.get();

    return snapshot.docs.map((doc) =>
      serializeActivityEvent(activityEventSchema.parse({ id: doc.id, ...doc.data() })),
    );
  }
}
