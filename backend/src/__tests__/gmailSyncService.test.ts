import { beforeEach, describe, expect, it, vi } from "vitest";
import { Timestamp, type Firestore } from "firebase-admin/firestore";

import { IntegrationWorkspaceService } from "../integrations/integrationWorkspaceService.js";
import { GmailProvider } from "../integrations/providers/gmail/gmailProvider.js";
import { GmailStyleProfileService } from "../integrations/providers/gmail/gmailStyleProfileService.js";
import { GmailSyncService } from "../integrations/providers/gmail/gmailSyncService.js";
import { IntegrationItemRepository } from "../repositories/integrationItemRepository.js";
import type { CurrentWorkspace } from "../services/currentWorkspaceService.js";
import { FakeFirestore } from "./helpers/fakeFirestore.js";

vi.mock("../ai/providers/providerRegistry.js", () => ({
  createLlmProvider: () => ({
    generateStructured: vi.fn(async (input: { schema: { parse(value: unknown): unknown }; systemPrompt?: string }) =>
      input.schema.parse(
        input.systemPrompt?.includes("[WRITING STYLE]")
          ? {
              subject: "Styled reply",
              body: "This uses the saved writing style.",
              rationale: "Grounded in thread and style profile.",
            }
          : {
              tone: "warm",
              formality: "semi-formal",
              greetingStyle: "Friendly opener",
              signOffStyle: "Short sign-off",
              sentenceLength: "short",
              commonPhrasing: ["Happy to help"],
              doPreferences: ["Be concise"],
              dontPreferences: ["Do not overpromise"],
              summary: "Clear, warm, concise.",
            },
      ),
    ),
  }),
}));

function asDb(fake: FakeFirestore) {
  return fake as unknown as Firestore;
}

function seedGmailConnection(fake: FakeFirestore, overrides: Record<string, unknown> = {}) {
  const now = Timestamp.now();
  fake.seed("workspaces/ws_test/integrations/gmail", {
    workspaceId: "ws_test",
    provider: "gmail",
    status: "connected",
    scopes: [],
    scopesGranted: [],
    tokenRef: "workspaces/ws_test/integrations/gmail",
    capabilities: ["email.read", "email.draft", "email.send"],
    syncError: null,
    connectedBy: "user_123",
    ownedByUserId: "user_123",
    syncStatus: "idle",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  });
}

function currentWorkspace(): CurrentWorkspace {
  const now = Timestamp.now();
  return {
    id: "ws_test",
    workspace: {
      id: "ws_test",
      name: "Workspace",
      ownerId: "user_123",
      plan: "pro",
      planSource: "manual",
      channelsConfig: { emailEnabled: false, whatsappEnabled: false },
      monthlyCreditsLimit: 100,
      monthlyCreditsUsed: 0,
      billingCycleStartAt: now,
      createdAt: now,
      updatedAt: now,
    },
    member: {
      userId: "user_123",
      workspaceId: "ws_test",
      role: "owner",
      status: "active",
      joinedAt: now,
      createdAt: now,
      updatedAt: now,
    },
    role: "owner",
  };
}

function sampleThread(threadId = "thread_1") {
  return {
    id: threadId,
    threadId,
    subject: "Follow-up on startup grants",
    snippet: "Quick note about funding options.",
    participants: ["founder@example.com", "advisor@example.com"],
    messages: [
      {
        id: `${threadId}_m1`,
        from: "founder@example.com",
        to: ["advisor@example.com"],
        cc: [],
        subject: "Follow-up on startup grants",
        sentAt: "2026-05-17T12:00:00.000Z",
        snippet: "Quick note about funding options.",
        bodyText: "Here are the latest thoughts on funding.",
      },
    ],
  };
}

describe("Gmail sync foundation", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("stores watch state after successful watch setup", async () => {
    const fake = new FakeFirestore();
    seedGmailConnection(fake);
    vi.spyOn(GmailProvider.prototype, "getMailboxProfile").mockResolvedValue({
      emailAddress: "founder@example.com",
      historyId: "101",
    });
    vi.spyOn(GmailProvider.prototype, "setupWatch").mockResolvedValue({
      historyId: "202",
      expiration: Timestamp.fromMillis(Date.now() + 60_000),
    });

    await new GmailSyncService(asDb(fake)).initializeConnectionMetadata("ws_test");

    const integration = fake.read("workspaces/ws_test/integrations/gmail");
    expect(integration?.["accountEmail"]).toBe("founder@example.com");
    expect(integration?.["watchStatus"]).toBe("active");
    expect(integration?.["watchHistoryId"]).toBe("202");
    expect(integration?.["lastHistoryId"]).toBe("202");
    expect(integration?.["watchExpiration"]).toBeInstanceOf(Timestamp);
  });

  it("manual refresh writes cached Gmail items with retention expiry", async () => {
    const fake = new FakeFirestore();
    seedGmailConnection(fake, {
      retentionDays: 30,
      accountEmail: "founder@example.com",
      accountEmailLower: "founder@example.com",
      lastHistoryId: "200",
    });
    vi.spyOn(GmailProvider.prototype, "listRecentInboxThreads").mockResolvedValue([sampleThread()]);
    vi.spyOn(GmailProvider.prototype, "getMailboxProfile").mockResolvedValue({
      emailAddress: "founder@example.com",
      historyId: "250",
    });

    await new GmailSyncService(asDb(fake)).manualRefresh("ws_test", "gmail", "user_123");

    const actualItem = fake.listPaths("workspaces/ws_test/integrationItems/")[0]?.data as Record<string, unknown> | undefined;

    expect(actualItem).toBeTruthy();
    expect(actualItem?.["expiresAt"]).toBeInstanceOf(Timestamp);
    expect((actualItem?.["expiresAt"] as Timestamp).toMillis()).toBeGreaterThan(Date.now());

    const integration = fake.read("workspaces/ws_test/integrations/gmail");
    expect(integration?.["lastHistoryId"]).toBe("250");
    expect(integration?.["fullResyncRequired"]).toBe(false);
  });

  it("processes Gmail history deltas and updates lastHistoryId only after success", async () => {
    const fake = new FakeFirestore();
    seedGmailConnection(fake, {
      lastHistoryId: "100",
      watchHistoryId: "100",
      accountEmail: "founder@example.com",
      accountEmailLower: "founder@example.com",
    });
    vi.spyOn(GmailProvider.prototype, "listHistory").mockResolvedValue({
      historyId: "150",
      changedThreadIds: ["thread_1"],
      changedMessageIds: ["m1"],
      nextPageToken: null,
    });
    vi.spyOn(GmailProvider.prototype, "getThread").mockResolvedValue(sampleThread());

    const result = await new GmailSyncService(asDb(fake)).processHistory("ws_test", "gmail", "150", "user_123");

    expect(result.processed).toBe(true);
    const integration = fake.read("workspaces/ws_test/integrations/gmail");
    expect(integration?.["lastHistoryId"]).toBe("150");
    expect(integration?.["fullResyncRequired"]).toBe(false);
  });

  it("does not update lastHistoryId when delta processing fails mid-flight", async () => {
    const fake = new FakeFirestore();
    seedGmailConnection(fake, {
      lastHistoryId: "100",
      watchHistoryId: "100",
    });
    vi.spyOn(GmailProvider.prototype, "listHistory").mockResolvedValue({
      historyId: "151",
      changedThreadIds: ["thread_1"],
      changedMessageIds: ["m1"],
      nextPageToken: null,
    });
    vi.spyOn(GmailProvider.prototype, "getThread").mockRejectedValue(new Error("gmail thread fetch failed"));

    await expect(
      new GmailSyncService(asDb(fake)).processHistory("ws_test", "gmail", "151", "user_123"),
    ).rejects.toThrow("gmail thread fetch failed");

    const integration = fake.read("workspaces/ws_test/integrations/gmail");
    expect(integration?.["lastHistoryId"]).toBe("100");
  });

  it("marks fullResyncRequired when Gmail history expires", async () => {
    const fake = new FakeFirestore();
    seedGmailConnection(fake, {
      lastHistoryId: "100",
      watchHistoryId: "100",
    });
    vi.spyOn(GmailProvider.prototype, "listHistory").mockRejectedValue({
      status: 404,
      message: "startHistoryId is too old",
    });

    const result = await new GmailSyncService(asDb(fake)).processHistory("ws_test", "gmail", "200", "user_123");

    expect(result.processed).toBe(false);
    const integration = fake.read("workspaces/ws_test/integrations/gmail");
    expect(integration?.["fullResyncRequired"]).toBe(true);
  });

  it("purges raw Gmail cache on disconnect cleanup", async () => {
    const fake = new FakeFirestore();
    seedGmailConnection(fake);
    fake.seed("workspaces/ws_test/integrationItems/item_1", {
      workspaceId: "ws_test",
      integrationId: "gmail",
      provider: "gmail",
      sourceType: "email_thread",
      externalId: "thread_1",
      title: "Thread 1",
      normalizedData: sampleThread(),
      summary: "summary",
      sourceHash: "hash_1",
      lastSyncedAt: Timestamp.now(),
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
      expiresAt: Timestamp.fromMillis(Date.now() + 1000),
    });

    await new GmailSyncService(asDb(fake)).purgeConnectionData("ws_test", "gmail");

    expect(fake.read("workspaces/ws_test/integrationItems/item_1")).toBeUndefined();
  });

  it("reads Gmail workspace list from cache without calling live listThreads", async () => {
    const fake = new FakeFirestore();
    seedGmailConnection(fake);
    fake.seed("workspaces/ws_test/integrationItems/cached_thread", {
      workspaceId: "ws_test",
      integrationId: "gmail",
      provider: "gmail",
      sourceType: "email_thread",
      externalId: "thread_1",
      title: "Cached thread",
      normalizedData: {
        ...sampleThread(),
        listItem: {
          id: "thread_1",
          threadId: "thread_1",
          subject: "Cached thread",
          snippet: "cached snippet",
          from: "founder@example.com",
          lastMessageAt: "2026-05-17T12:00:00.000Z",
          unread: false,
        },
      },
      summary: "cached snippet",
      sourceHash: "hash_cached",
      lastSyncedAt: Timestamp.now(),
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
      expiresAt: Timestamp.fromMillis(Date.now() + 1000),
    });
    const listSpy = vi.spyOn(GmailProvider.prototype, "listThreads");

    const workspace = await new IntegrationWorkspaceService(asDb(fake)).getWorkspaceData(
      currentWorkspace(),
      "user_123",
      "gmail",
      {},
    );

    expect(listSpy).not.toHaveBeenCalled();
    expect((workspace as { list: Array<{ threadId: string }> }).list.length).toBeGreaterThan(0);
  });

  it("sanitizes malformed cached Gmail dates so older bogus threads do not outrank newer ones", async () => {
    const fake = new FakeFirestore();
    seedGmailConnection(fake);
    await new IntegrationItemRepository(asDb(fake)).syncItems(
      { id: "gmail", workspaceId: "ws_test", provider: "gmail" },
      [
        {
          sourceType: "email_thread",
          externalId: "thread_bad",
          title: "Bogus timestamp thread",
          summary: "bad timestamp",
          normalizedData: {
            ...sampleThread("thread_bad"),
            messages: [
              {
                id: "thread_bad_m1",
                from: "system@example.com",
                to: ["founder@example.com"],
                cc: [],
                subject: "Bogus timestamp thread",
                sentAt: "2612-01-09T03:35:20.000Z",
                snippet: "bad timestamp",
                bodyText: "cached body",
              },
            ],
          },
          expiresAt: Timestamp.fromMillis(Date.now() + 1000),
        },
        {
          sourceType: "email_thread",
          externalId: "thread_recent",
          title: "Recent thread",
          summary: "recent timestamp",
          normalizedData: sampleThread("thread_recent"),
          expiresAt: Timestamp.fromMillis(Date.now() + 1000),
        },
      ],
    );
    const threadBadPath = fake
      .listPaths("workspaces/ws_test/integrationItems/")
      .find((entry) => entry.data["externalId"] === "thread_bad")?.path;
    if (threadBadPath) {
      fake.seed(threadBadPath, {
        ...(fake.read(threadBadPath) as Record<string, unknown>),
        lastSyncedAt: Timestamp.fromDate(new Date("2026-01-09T03:35:20.000Z")),
      });
    }

    const service = new IntegrationWorkspaceService(asDb(fake));
    const workspace = await service.getWorkspaceData(currentWorkspace(), "user_123", "gmail", {});
    const selected = await service.getSelectedItemDetail(currentWorkspace(), "user_123", "gmail", { itemId: "thread_bad" });

    const threadList = (workspace as { list: Array<{ threadId: string }> }).list;
    expect(threadList[0]?.threadId).toBe("thread_recent");
    expect((selected.detail as { messages: Array<{ sentAt: string | null }> }).messages[0]?.sentAt).toBeNull();
  });

  it("bounds Gmail writing-style analysis to at most 50 sent emails", async () => {
    const fake = new FakeFirestore();
    seedGmailConnection(fake);
    const sampleSpy = vi.spyOn(GmailProvider.prototype, "listSentMessagesForStyle").mockResolvedValue([
      {
        id: "m1",
        threadId: "t1",
        subject: "Hello",
        sentAt: "2026-05-17T12:00:00.000Z",
        bodyText: "Happy to help with this.",
      },
    ]);

    const profile = await new GmailStyleProfileService(asDb(fake)).analyzeProfile(
      currentWorkspace(),
      "user_123",
      999,
    );

    expect(sampleSpy).toHaveBeenCalledWith(expect.anything(), { sampleSize: 50 });
    expect(profile.sampleSize).toBe(1);
  });

  it("uses the saved Gmail writing style when drafting replies", async () => {
    const fake = new FakeFirestore();
    const service = new IntegrationWorkspaceService(asDb(fake));
    vi.spyOn(service, "getSelectedItemDetail").mockResolvedValue({
      provider: "gmail",
      detail: sampleThread(),
      sourceRefs: [],
      contextBundleId: "ctx_1",
      selectedContext: {
        provider: "gmail",
        itemId: "thread_1",
        itemType: "email_thread",
        title: "Thread 1",
        summary: "summary",
        content: "Thread content",
        metadata: {},
        sourceRefs: [],
      },
    });
    vi.spyOn(GmailStyleProfileService.prototype, "getProfile").mockResolvedValue({
      id: "user_123",
      workspaceId: "ws_test",
      userId: "user_123",
      sampleSize: 25,
      tone: "warm",
      formality: "semi-formal",
      greetingStyle: "Friendly opener",
      signOffStyle: "Short sign-off",
      sentenceLength: "short",
      commonPhrasing: ["Happy to help"],
      doPreferences: ["Be concise"],
      dontPreferences: ["Do not overpromise"],
      summary: "Clear, warm, concise.",
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });

    const result = await service.draftGmailReply(
      currentWorkspace(),
      "user_123",
      "thread_1",
    );

    expect(result.subject).toBe("Styled reply");
    expect(result.body).toContain("saved writing style");
  });

  it("keeps Gmail send approval-gated", async () => {
    const fake = new FakeFirestore();
    seedGmailConnection(fake);
    const service = new IntegrationWorkspaceService(asDb(fake));
    vi.spyOn(service, "draftGmailReply").mockResolvedValue({
      subject: "Reply subject",
      body: "Draft body",
      rationale: "Because it matches the thread.",
      sourceRefs: [],
      contextBundleId: "ctx_1",
    });
    vi.spyOn(service, "getSelectedItemDetail").mockResolvedValue({
      provider: "gmail",
      detail: sampleThread(),
      sourceRefs: [],
      contextBundleId: "ctx_1",
      selectedContext: {
        provider: "gmail",
        itemId: "thread_1",
        itemType: "email_thread",
        title: "Thread 1",
        summary: "summary",
        content: "Thread content",
        sourceRefs: [],
        metadata: {},
      },
    });
    const createApproval = vi.fn(async (input: Record<string, unknown>) => ({ id: "approval_1", ...input }));
    (service as unknown as { approvalService: { createApproval: typeof createApproval } }).approvalService = {
      createApproval,
    };

    await service.prepareGmailSendApproval(
      currentWorkspace(),
      "user_123",
      {
        threadId: "thread_1",
        to: ["recipient@example.com"],
      },
    );

    expect(createApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "email_send",
        proposedAction: expect.objectContaining({
          requiresApproval: true,
          actionType: "gmail_send",
        }),
      }),
    );
  });

  it("creates outbound Gmail send approvals without requiring a thread id", async () => {
    const fake = new FakeFirestore();
    seedGmailConnection(fake);
    const service = new IntegrationWorkspaceService(asDb(fake));
    const createApproval = vi.fn(async (input: Record<string, unknown>) => ({ id: "approval_outbound", ...input }));
    (service as unknown as { approvalService: { createApproval: typeof createApproval } }).approvalService = {
      createApproval,
    };

    const result = await service.prepareGmailSendApproval(currentWorkspace(), "user_123", {
      to: ["sharad@xoidlabs.com"],
      subject: "Pitching Gideon",
      body: "Here is the short pitch.",
    });

    expect(result.approvalId).toBe("approval_outbound");
    expect(createApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        title: expect.stringContaining("Send Gmail email"),
        proposedAction: expect.objectContaining({
          input: expect.objectContaining({
            threadId: undefined,
            to: ["sharad@xoidlabs.com"],
            subject: "Pitching Gideon",
          }),
        }),
      }),
    );
  });

  it("creates outbound Gmail drafts without requiring a thread id", async () => {
    const fake = new FakeFirestore();
    seedGmailConnection(fake);
    vi.spyOn(GmailProvider.prototype, "createDraft").mockResolvedValue({
      draftId: "draft_1",
      messageId: "message_1",
    });

    const result = await new IntegrationWorkspaceService(asDb(fake)).createGmailDraft(
      currentWorkspace(),
      "user_123",
      {
        to: ["sharad@xoidlabs.com"],
        subject: "Pitching Gideon",
        body: "Here is the short pitch.",
      },
    );

    expect(result.draftId).toBe("draft_1");
    expect(result.subject).toBe("Pitching Gideon");
    expect(result.to).toEqual(["sharad@xoidlabs.com"]);
  });
});
