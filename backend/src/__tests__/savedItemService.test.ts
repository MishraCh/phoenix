import { describe, expect, it } from "vitest";
import { Timestamp, type Firestore } from "firebase-admin/firestore";

import { SavedItemService } from "../savedItems/savedItemService.js";
import type { CurrentWorkspace } from "../services/currentWorkspaceService.js";
import { FakeFirestore } from "./helpers/fakeFirestore.js";

function buildWorkspace(): CurrentWorkspace {
  const now = Timestamp.now();
  return {
    id: "ws_1",
    workspace: {
      id: "ws_1",
      name: "Workspace",
      ownerId: "user_1",
      plan: "pro",
      planSource: "system",
      channelsConfig: { emailEnabled: false, whatsappEnabled: false },
      monthlyCreditsLimit: 1000,
      monthlyCreditsUsed: 0,
      billingCycleStartAt: now,
      createdAt: now,
      updatedAt: now,
    },
    member: {
      userId: "user_1",
      workspaceId: "ws_1",
      role: "admin",
      status: "active",
      createdAt: now,
      updatedAt: now,
    },
    role: "admin",
  };
}

function seedAssistantMessage(db: FakeFirestore) {
  const now = Timestamp.now();
  db.seed("workspaces/ws_1/commandSessions/session_1/messages/assistant_1", {
    id: "assistant_1",
    role: "assistant",
    content: "Rippling is the best fit for most small and midsize teams because it unifies HR, payroll, and IT.",
    responseJson: JSON.stringify({
      answer: "Rippling is the best fit for most small and midsize teams because it unifies HR, payroll, and IT.",
      result: {
        kind: "answer",
        summary: "Best-fit HR software recommendation",
        highlights: [],
        sections: [],
      },
    }),
    mode: "research",
    sourceRefs: [],
    artifactIds: [],
    starredByUserIds: [],
    createdAt: now,
  });
}

describe("SavedItemService", () => {
  it("creates one saved item per assistant response and writes the backlink to the message", async () => {
    const db = new FakeFirestore();
    seedAssistantMessage(db);
    const service = new SavedItemService(db as unknown as Firestore);
    const workspace = buildWorkspace();

    const first = await service.saveAssistantResponse(workspace, "user_1", "session_1", "assistant_1");
    const second = await service.saveAssistantResponse(workspace, "user_1", "session_1", "assistant_1");

    expect(first.id).toBe(second.id);
    const savedItems = db.listPaths("workspaces/ws_1/savedItems/");
    expect(savedItems).toHaveLength(1);

    const message = db.read("workspaces/ws_1/commandSessions/session_1/messages/assistant_1");
    expect(message?.savedItemId).toBe(first.id);
  });

  it("clears the message backlink when a saved response is removed", async () => {
    const db = new FakeFirestore();
    seedAssistantMessage(db);
    const service = new SavedItemService(db as unknown as Firestore);
    const workspace = buildWorkspace();

    const savedItem = await service.saveAssistantResponse(workspace, "user_1", "session_1", "assistant_1");
    await service.deleteSavedItem(workspace, savedItem.id);

    expect(db.listPaths("workspaces/ws_1/savedItems/")).toHaveLength(0);
    const message = db.read("workspaces/ws_1/commandSessions/session_1/messages/assistant_1");
    expect(message?.savedItemId).toBeUndefined();
  });
});
