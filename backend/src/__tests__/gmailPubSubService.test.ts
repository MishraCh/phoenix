import { beforeEach, describe, expect, it, vi } from "vitest";
import { google } from "googleapis";
import { Timestamp, type Firestore } from "firebase-admin/firestore";

import { env } from "../config/env.js";
import { GmailPubSubService } from "../integrations/providers/gmail/gmailPubSubService.js";
import { FakeFirestore } from "./helpers/fakeFirestore.js";

function asDb(fake: FakeFirestore) {
  return fake as unknown as Firestore;
}

function encodePayload(payload: Record<string, unknown>) {
  return {
    message: {
      data: Buffer.from(JSON.stringify(payload), "utf8").toString("base64"),
      messageId: "msg_1",
    },
  };
}

describe("Gmail Pub/Sub webhook handling", () => {
  const originalAudience = env.GMAIL_PUBSUB_AUDIENCE;
  const originalServiceAccount = env.GMAIL_PUBSUB_SERVICE_ACCOUNT_EMAIL;

  beforeEach(() => {
    vi.restoreAllMocks();
    env.GMAIL_PUBSUB_AUDIENCE = originalAudience;
    env.GMAIL_PUBSUB_SERVICE_ACCOUNT_EMAIL = originalServiceAccount;
  });

  it("decodes the Pub/Sub push envelope", () => {
    const service = new GmailPubSubService(asDb(new FakeFirestore()));

    const decoded = service.decodeEnvelope(
      encodePayload({
        emailAddress: "founder@example.com",
        historyId: "12345",
      }),
    );

    expect(decoded.emailAddress).toBe("founder@example.com");
    expect(decoded.historyId).toBe("12345");
  });

  it("dedupes duplicate Gmail push notifications into one delta job", async () => {
    const fake = new FakeFirestore();
    const now = Timestamp.now();
    fake.seed("workspaces/ws_test/integrations/gmail", {
      workspaceId: "ws_test",
      provider: "gmail",
      status: "connected",
      scopes: [],
      scopesGranted: [],
      capabilities: ["email.read", "email.draft", "email.send"],
      connectedBy: "user_123",
      ownedByUserId: "user_123",
      accountEmail: "founder@example.com",
      accountEmailLower: "founder@example.com",
      createdAt: now,
      updatedAt: now,
    });

    const service = new GmailPubSubService(asDb(fake));
    const envelope = encodePayload({
      emailAddress: "founder@example.com",
      historyId: "888",
    });

    const first = await service.enqueueDeltaJobs(envelope);
    const second = await service.enqueueDeltaJobs(envelope);

    expect(first.queued).toBe(1);
    expect(second.queued).toBe(1);
    const jobs = fake.listPaths("workspaces/ws_test/jobLocks/");
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.path).toContain("gmail_delta:ws_test:gmail:888");
  });

  it("accepts a valid Pub/Sub OIDC token when audience verification is configured", async () => {
    const fake = new FakeFirestore();
    const now = Timestamp.now();
    env.GMAIL_PUBSUB_AUDIENCE = "https://gideon.example.com/webhooks/gmail/pubsub";
    env.GMAIL_PUBSUB_SERVICE_ACCOUNT_EMAIL = "gmail-push@example.iam.gserviceaccount.com";
    fake.seed("workspaces/ws_test/integrations/gmail", {
      workspaceId: "ws_test",
      provider: "gmail",
      status: "connected",
      scopes: [],
      scopesGranted: [],
      capabilities: ["email.read", "email.draft", "email.send"],
      connectedBy: "user_123",
      ownedByUserId: "user_123",
      accountEmail: "founder@example.com",
      accountEmailLower: "founder@example.com",
      createdAt: now,
      updatedAt: now,
    });
    vi.spyOn(google.auth.OAuth2.prototype, "verifyIdToken").mockResolvedValue({
      getPayload: () => ({ email: "gmail-push@example.iam.gserviceaccount.com" }),
    } as never);

    const result = await new GmailPubSubService(asDb(fake)).enqueueDeltaJobs(
      encodePayload({ emailAddress: "founder@example.com", historyId: "900" }),
      "Bearer valid-token",
    );

    expect(result.queued).toBe(1);
  });

  it("rejects Pub/Sub pushes with missing auth when audience verification is configured", async () => {
    env.GMAIL_PUBSUB_AUDIENCE = "https://gideon.example.com/webhooks/gmail/pubsub";

    await expect(
      new GmailPubSubService(asDb(new FakeFirestore())).enqueueDeltaJobs(
        encodePayload({ emailAddress: "founder@example.com", historyId: "901" }),
      ),
    ).rejects.toMatchObject({ status: 401 });
  });

  it("rejects Pub/Sub pushes with invalid tokens", async () => {
    env.GMAIL_PUBSUB_AUDIENCE = "https://gideon.example.com/webhooks/gmail/pubsub";
    vi.spyOn(google.auth.OAuth2.prototype, "verifyIdToken").mockRejectedValue(new Error("invalid token"));

    await expect(
      new GmailPubSubService(asDb(new FakeFirestore())).enqueueDeltaJobs(
        encodePayload({ emailAddress: "founder@example.com", historyId: "902" }),
        "Bearer invalid-token",
      ),
    ).rejects.toMatchObject({ status: 401 });
  });

  it("rejects Pub/Sub pushes from the wrong service account when configured", async () => {
    env.GMAIL_PUBSUB_AUDIENCE = "https://gideon.example.com/webhooks/gmail/pubsub";
    env.GMAIL_PUBSUB_SERVICE_ACCOUNT_EMAIL = "expected@example.iam.gserviceaccount.com";
    vi.spyOn(google.auth.OAuth2.prototype, "verifyIdToken").mockResolvedValue({
      getPayload: () => ({ email: "wrong@example.iam.gserviceaccount.com" }),
    } as never);

    await expect(
      new GmailPubSubService(asDb(new FakeFirestore())).enqueueDeltaJobs(
        encodePayload({ emailAddress: "founder@example.com", historyId: "903" }),
        "Bearer wrong-service-account",
      ),
    ).rejects.toMatchObject({ status: 401 });
  });
});
