import { randomUUID } from "node:crypto";

import type { Firestore } from "firebase-admin/firestore";

import { ArtifactService } from "../artifacts/artifactService.js";
import { CommandSessionRepository } from "../repositories/commandSessionRepository.js";
import { SavedItemRepository } from "../repositories/savedItemRepository.js";
import type { CommandSessionMessage, CommandSessionMode, SavedItem } from "../schemas/coreSchemas.js";
import type { CurrentWorkspace } from "../services/currentWorkspaceService.js";
import { ApiError } from "../utils/apiError.js";

type PromoteSavedItemInput = {
  title?: string;
  artifactType: "report" | "draft" | "summary" | "data" | "document";
};

function trimPreview(text: string, max = 240) {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
}

function readSummaryFromResponseJson(responseJson?: string) {
  if (!responseJson) {
    return null;
  }

  try {
    const parsed = JSON.parse(responseJson) as { result?: { summary?: unknown; sections?: Array<{ title?: unknown }> } };
    if (typeof parsed.result?.summary === "string" && parsed.result.summary.trim()) {
      return parsed.result.summary.trim();
    }

    const firstSectionTitle = parsed.result?.sections?.find((section) => typeof section.title === "string" && section.title.trim())?.title;
    return typeof firstSectionTitle === "string" ? firstSectionTitle.trim() : null;
  } catch {
    return null;
  }
}

function buildSavedResponseTitle(message: CommandSessionMessage) {
  return trimPreview(readSummaryFromResponseJson(message.responseJson) ?? message.content, 120) || "Saved response";
}

function buildFullContentText(message: CommandSessionMessage): string {
  let fullText = message.content;
  if (message.responseJson) {
    try {
      const parsed = JSON.parse(message.responseJson) as { result?: { sections?: Array<{ title?: string; body?: string }> } };
      if (parsed.result?.sections && Array.isArray(parsed.result.sections) && parsed.result.sections.length > 0) {
        const sectionsText = parsed.result.sections
          .map((s) => `${s.title ? `### ${s.title}\n\n` : ""}${s.body || ""}`)
          .join("\n\n---\n\n");
        fullText = fullText ? `${fullText}\n\n${sectionsText}` : sectionsText;
      }
    } catch {
      // Ignore parse errors
    }
  }
  return fullText;
}

function ensureAssistantMessage(
  message: CommandSessionMessage | null,
): asserts message is CommandSessionMessage & { role: "assistant" } {
  if (!message) {
    throw new ApiError({
      code: "NOT_FOUND",
      message: "Assistant message not found.",
      status: 404,
    });
  }

  if (message.role !== "assistant") {
    throw new ApiError({
      code: "VALIDATION_ERROR",
      message: "Only assistant responses can be saved or starred.",
      status: 400,
    });
  }
}

export class SavedItemService {
  private readonly repo: SavedItemRepository;
  private readonly commandSessionRepo: CommandSessionRepository;
  private readonly artifactService: ArtifactService;

  constructor(private readonly db: Firestore) {
    this.repo = new SavedItemRepository(db);
    this.commandSessionRepo = new CommandSessionRepository(db);
    this.artifactService = new ArtifactService(db);
  }

  async listSavedItems(workspace: CurrentWorkspace) {
    return this.repo.list(workspace.id);
  }

  async getSavedItem(workspace: CurrentWorkspace, savedItemId: string) {
    const savedItem = await this.repo.get(workspace.id, savedItemId);
    if (!savedItem) {
      throw new ApiError({
        code: "NOT_FOUND",
        message: "Saved item not found.",
        status: 404,
      });
    }

    return savedItem;
  }

  async saveAssistantResponse(
    workspace: CurrentWorkspace,
    userId: string,
    sessionId: string,
    assistantMessageId: string,
  ): Promise<SavedItem> {
    const message = await this.commandSessionRepo.getMessage(workspace.id, sessionId, assistantMessageId);
    ensureAssistantMessage(message);

    if (message.savedItemId) {
      const existingByBacklink = await this.repo.get(workspace.id, message.savedItemId);
      if (existingByBacklink) {
        return existingByBacklink;
      }
    }

    const existing = await this.repo.findByAssistantMessage(workspace.id, sessionId, assistantMessageId);
    if (existing) {
      if (message.savedItemId !== existing.id) {
        await this.commandSessionRepo.updateMessage(workspace.id, sessionId, assistantMessageId, { savedItemId: existing.id });
      }
      return existing;
    }

    const savedItem = await this.repo.create(workspace.id, {
      id: randomUUID(),
      workspaceId: workspace.id,
      sourceType: "command_response",
      sourceSessionId: sessionId,
      sourceAssistantMessageId: assistantMessageId,
      itemType: "saved_response",
      title: buildSavedResponseTitle(message),
      previewText: trimPreview(buildFullContentText(message)),
      contentText: buildFullContentText(message),
      responseJson: message.responseJson,
      mode: message.mode as CommandSessionMode,
      sourceRefs: message.sourceRefs,
      createdByUserId: userId,
    });

    await this.commandSessionRepo.updateMessage(workspace.id, sessionId, assistantMessageId, { savedItemId: savedItem.id });
    return savedItem;
  }

  async deleteSavedItem(workspace: CurrentWorkspace, savedItemId: string): Promise<void> {
    const savedItem = await this.getSavedItem(workspace, savedItemId);
    await this.repo.delete(workspace.id, savedItemId);

    if (savedItem.sourceType === "command_response" && savedItem.sourceSessionId && savedItem.sourceAssistantMessageId) {
      const message = await this.commandSessionRepo.getMessage(
        workspace.id,
        savedItem.sourceSessionId,
        savedItem.sourceAssistantMessageId,
      );
      if (message?.savedItemId === savedItemId) {
        await this.commandSessionRepo.updateMessage(workspace.id, savedItem.sourceSessionId, savedItem.sourceAssistantMessageId, {
          savedItemId: undefined,
        });
      }
    }
  }

  async promoteSavedItem(
    workspace: CurrentWorkspace,
    userId: string,
    savedItemId: string,
    input: PromoteSavedItemInput,
  ) {
    const savedItem = await this.getSavedItem(workspace, savedItemId);
    if (savedItem.promotedArtifactId) {
      return this.artifactService.getArtifact(workspace.workspace, savedItem.promotedArtifactId);
    }

    const artifact = await this.artifactService.createArtifact({
      workspace: workspace.workspace,
      userId,
      title: input.title?.trim() || savedItem.title,
      artifactType: input.artifactType,
      content: savedItem.contentText,
      sourceRefs: savedItem.sourceRefs,
      creationSource: "saved_response_promotion",
      sourceSessionId: savedItem.sourceSessionId,
      sourceAssistantMessageId: savedItem.sourceAssistantMessageId,
    });

    await this.repo.update(workspace.id, savedItem.id, { promotedArtifactId: artifact.id });
    return artifact;
  }

  async createArtifactFromAssistantResponse(
    workspace: CurrentWorkspace,
    userId: string,
    sessionId: string,
    assistantMessageId: string,
    input: PromoteSavedItemInput,
  ) {
    const message = await this.commandSessionRepo.getMessage(workspace.id, sessionId, assistantMessageId);
    ensureAssistantMessage(message);

    if (message.savedItemId) {
      const savedItem = await this.repo.get(workspace.id, message.savedItemId);
      if (savedItem?.promotedArtifactId) {
        return this.artifactService.getArtifact(workspace.workspace, savedItem.promotedArtifactId);
      }
    }

    const artifact = await this.artifactService.createArtifact({
      workspace: workspace.workspace,
      userId,
      title: input.title?.trim() || buildSavedResponseTitle(message),
      artifactType: input.artifactType,
      content: buildFullContentText(message),
      sourceRefs: message.sourceRefs,
      creationSource: "command_explicit",
      sourceSessionId: sessionId,
      sourceAssistantMessageId: assistantMessageId,
      generatedByAgentId: message.agentId,
    });

    if (message.savedItemId) {
      const savedItem = await this.repo.get(workspace.id, message.savedItemId);
      if (savedItem && !savedItem.promotedArtifactId) {
        await this.repo.update(workspace.id, savedItem.id, { promotedArtifactId: artifact.id });
      }
    }

    return artifact;
  }
}
