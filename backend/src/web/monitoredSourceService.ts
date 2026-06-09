import { Timestamp, type Firestore } from "firebase-admin/firestore";

import { ActivityService } from "../activity/activityService.js";
import { ArtifactService } from "../artifacts/artifactService.js";
import { NotificationService } from "../notifications/notificationService.js";
import { MonitoredSourceRepository } from "../repositories/monitoredSourceRepository.js";
import type { CurrentWorkspace } from "../services/currentWorkspaceService.js";
import type { MonitoredSource } from "../schemas/coreSchemas.js";
import { ApiError } from "../utils/apiError.js";
import { WebIntelligenceService } from "./webIntelligenceService.js";


type CreateMonitoredSourceInput = {
  currentWorkspace: CurrentWorkspace;
  userId: string;
  type: MonitoredSource["type"];
  value: string;
  frequency?: MonitoredSource["frequency"];
  workflowId?: string;
};

type RunMonitorCheckInput = {
  currentWorkspace: CurrentWorkspace;
  userId: string;
  sourceId: string;
  objective?: string;
  processor?: string;
  workflowId?: string;
  workflowRunId?: string;
};

export class MonitoredSourceService {
  private readonly repository: MonitoredSourceRepository;
  private readonly webService: WebIntelligenceService;
  private readonly activityService: ActivityService;
  private readonly artifactService: ArtifactService;
  private readonly notificationService: NotificationService;

  constructor(private readonly db: Firestore) {
    this.repository = new MonitoredSourceRepository(db);
    this.webService = new WebIntelligenceService(db);
    this.activityService = new ActivityService(db);
    this.artifactService = new ArtifactService(db);
    this.notificationService = new NotificationService(db);
  }

  async create(input: CreateMonitoredSourceInput): Promise<MonitoredSource> {
    const source = await this.repository.create({
      workspaceId: input.currentWorkspace.id,
      type: input.type,
      value: input.value,
      frequency: input.frequency ?? "manual",
      workflowId: input.workflowId,
      createdBy: input.userId,
    });

    await this.activityService.createEvent({
      workspaceId: input.currentWorkspace.id,
      type: "monitor.source_created",
      title: `Monitoring configured: ${input.type} — ${input.value}`,
      actorType: "user",
      actorId: input.userId,
      metadata: { monitoredSourceId: source.id, targetType: input.type, target: input.value },
    });

    return source;
  }

  async list(workspaceId: string): Promise<MonitoredSource[]> {
    return this.repository.listByWorkspace(workspaceId);
  }

  async getById(workspaceId: string, sourceId: string): Promise<MonitoredSource> {
    const source = await this.repository.getById(workspaceId, sourceId);

    if (!source) {
      throw new ApiError({ code: "NOT_FOUND", message: "Monitored source not found.", status: 404 });
    }

    return source;
  }

  async update(
    workspaceId: string,
    sourceId: string,
    updates: Partial<Pick<MonitoredSource, "status" | "frequency">>,
  ): Promise<MonitoredSource> {
    return this.repository.update(workspaceId, sourceId, updates);
  }

  async runCheck(input: RunMonitorCheckInput): Promise<{ changed: boolean; artifactId?: string }> {
    const source = await this.getById(input.currentWorkspace.id, input.sourceId);

    if (source.status === "paused") {
      await this.activityService.createEvent({
        workspaceId: input.currentWorkspace.id,
        type: "web.monitor.skipped",
        title: `Monitor check skipped — source is paused: ${source.type} "${source.value}"`,
        actorType: "system",
        actorId: input.userId,
        metadata: { monitoredSourceId: source.id },
      });

      return { changed: false };
    }

    const checkResult = await this.webService.monitorCheck({
      currentWorkspace: input.currentWorkspace,
      userId: input.userId,
      targetType: source.type,
      target: source.value,
      objective: input.objective,
      processor: input.processor,
    });

    const now = Timestamp.now();

    await this.repository.update(input.currentWorkspace.id, input.sourceId, {
      lastCheckedAt: now,
      lastContentHash: checkResult.currentContentHash,
      ...(checkResult.changed ? { lastChangedAt: now } : {}),
    });

    if (!checkResult.changed) {
      await this.activityService.createEvent({
        workspaceId: input.currentWorkspace.id,
        type: "web.monitor.no_change",
        title: `Monitor check: no change detected — ${source.type} "${source.value}"`,
        actorType: "system",
        actorId: input.userId,
        metadata: {
          monitoredSourceId: source.id,
          targetType: source.type,
          target: source.value,
          contentHash: checkResult.currentContentHash,
        },
      });

      return { changed: false };
    }

    // Content changed — create artifact + notification
    const contentText =
      checkResult.contentText ??
      `Content change detected for ${source.type} "${source.value}".`;

    const artifact = await this.artifactService.createArtifact({
      workspace: input.currentWorkspace.workspace,
      userId: input.userId,
      title: `Monitor update: ${source.value}`,
      artifactType: "report",
      content: contentText,
      sourceRefs: checkResult.sourceRefs,
      inputHash: checkResult.currentContentHash,
      creationSource: "monitor",
      workflowId: source.workflowId,
    });

    await this.notificationService.createNotification({
      workspaceId: input.currentWorkspace.id,
      userId: input.userId,
      type: "report_ready",
      title: `Change detected: ${source.value}`,
      body: `A meaningful change was detected for monitored ${source.type} "${source.value}". A new report has been saved to your Library.`,
      actionUrl: `/library/${artifact.id}`,
      related: {
        artifactId: artifact.id,
        monitoredSourceId: source.id,
        ...(input.workflowId ? { workflowId: input.workflowId } : {}),
      },
    });

    await this.activityService.createEvent({
      workspaceId: input.currentWorkspace.id,
      type: "web.monitor.changed",
      title: `Monitor change detected: ${source.type} "${source.value}"`,
      actorType: "system",
      actorId: input.userId,
      related: {
        artifactId: artifact.id,
        workflowId: input.workflowId,
        workflowRunId: input.workflowRunId,
      },
      metadata: {
        monitoredSourceId: source.id,
        targetType: source.type,
        target: source.value,
        previousHash: checkResult.previousContentHash,
        currentHash: checkResult.currentContentHash,
        provider: checkResult.provider,
        sourceCount: checkResult.sourceRefs.length,
      },
    });

    return { changed: true, artifactId: artifact.id };
  }
}
