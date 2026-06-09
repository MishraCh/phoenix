import { google } from "googleapis";
import { Timestamp, type Firestore } from "firebase-admin/firestore";

import { env } from "../../../config/env.js";
import { ApiError } from "../../../utils/apiError.js";
import { parseIntegrationOAuthState, createIntegrationOAuthState } from "../../core/oauthState.js";
import type {
  IntegrationConnection,
  IntegrationConnectionStatus,
  IntegrationConnectContext,
  IntegrationConnectResult,
  IntegrationExchangeResult,
  IntegrationProvider,
  IntegrationTokenPayload,
} from "../../core/integrationContracts.js";
import { IntegrationTokenStore } from "../../tokenStore/integrationTokenStore.js";

const gmailScopes = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/gmail.send",
];

const MAX_MANUAL_BACKFILL_THREADS = 100;
const MAX_STYLE_MESSAGES = 50;

function createOAuthClient() {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_REDIRECT_URI) {
    throw new ApiError({
      code: "INTEGRATION_CONFIG_MISSING",
      message:
        "Gmail OAuth is not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI.",
      status: 500,
    });
  }

  return new google.auth.OAuth2(
    env.GOOGLE_CLIENT_ID,
    env.GOOGLE_CLIENT_SECRET,
    env.GOOGLE_REDIRECT_URI,
  );
}

function parseScopes(scope: string | undefined) {
  return scope?.split(/\s+/).filter(Boolean) ?? [...gmailScopes];
}

function encodeBase64Url(value: string) {
  return Buffer.from(value, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

type GmailPayloadPart = {
  mimeType?: string | null;
  body?: { data?: string | null };
  parts?: GmailPayloadPart[];
  headers?: Array<{ name?: string | null; value?: string | null }>;
};

type GmailMessage = {
  id: string;
  from: string;
  to: string[];
  cc: string[];
  subject: string;
  sentAt: string | null;
  snippet: string;
  bodyText: string;
};

const MAX_REASONABLE_FUTURE_MS = 1000 * 60 * 60 * 24 * 30;

function normalizeGmailTimestamp(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  let timestamp: number | null = null;

  if (typeof value === "number" || /^\d+$/.test(String(value))) {
    const numericValue = typeof value === "number" ? value : Number(value);
    if (Number.isFinite(numericValue) && numericValue > 0) {
      timestamp = numericValue > 1_000_000_000_000 ? numericValue : numericValue * 1000;
    }
  } else {
    const parsed = Date.parse(String(value));
    if (Number.isFinite(parsed)) {
      timestamp = parsed;
    }
  }

  if (!timestamp || Number.isNaN(timestamp)) {
    return null;
  }

  if (timestamp > Date.now() + MAX_REASONABLE_FUTURE_MS) {
    return null;
  }

  return new Date(timestamp).toISOString();
}

export type GmailThreadListItem = {
  id: string;
  threadId: string;
  subject: string;
  snippet: string;
  from: string;
  lastMessageAt: string | null;
  unread: boolean;
};

export type GmailThreadDetail = {
  id: string;
  threadId: string;
  subject: string;
  snippet: string;
  participants: string[];
  messages: GmailMessage[];
};

export type GmailWatchState = {
  historyId: string;
  expiration: Timestamp | null;
};

export type GmailMailboxProfile = {
  emailAddress: string;
  historyId: string | null;
};

export type GmailHistoryChangeSet = {
  historyId: string | null;
  changedThreadIds: string[];
  changedMessageIds: string[];
  nextPageToken: string | null;
};

export type GmailStyleSampleMessage = {
  id: string;
  threadId: string;
  subject: string;
  sentAt: string | null;
  bodyText: string;
};

export class GmailProvider implements IntegrationProvider {
  readonly id = "gmail" as const;
  readonly displayName = "Gmail";
  readonly defaultCapabilities = ["email.read", "email.draft", "email.send"];

  private readonly tokenStore: IntegrationTokenStore;

  constructor(private readonly db: Firestore) {
    this.tokenStore = new IntegrationTokenStore(db);
  }

  getRequiredScopes() {
    return [...gmailScopes];
  }

  async getConnectUrl(context: IntegrationConnectContext): Promise<IntegrationConnectResult> {
    const state = createIntegrationOAuthState({
      workspaceId: context.workspaceId,
      userId: context.userId,
      provider: "gmail",
      createdAt: Date.now(),
    });

    const authUrl = createOAuthClient().generateAuthUrl({
      access_type: "offline",
      include_granted_scopes: true,
      prompt: "consent",
      scope: gmailScopes,
      state,
    });

    return { authUrl };
  }

  async exchangeCode(input: { code: string; state: string }): Promise<IntegrationExchangeResult> {
    parseIntegrationOAuthState(input.state, "gmail");
    const oauth = createOAuthClient();
    const { tokens } = await oauth.getToken(input.code);

    return {
      status: "connected",
      scopes: parseScopes(tokens.scope),
      capabilities: [...this.defaultCapabilities],
      tokenPayload: {
        accessToken: tokens.access_token ?? undefined,
        refreshToken: tokens.refresh_token ?? undefined,
        tokenType: tokens.token_type ?? undefined,
        scope: tokens.scope ?? undefined,
        expiryDate: typeof tokens.expiry_date === "number" ? tokens.expiry_date : undefined,
        idToken: tokens.id_token ?? undefined,
      },
      tokenExpiresAt:
        typeof tokens.expiry_date === "number"
          ? Timestamp.fromMillis(tokens.expiry_date)
          : undefined,
    };
  }

  async refreshAccessTokenIfNeeded(connection: IntegrationConnection): Promise<IntegrationTokenPayload> {
    const stored = await this.tokenStore.read(connection);

    if (!stored) {
      throw new ApiError({
        code: "INTEGRATION_TOKEN_MISSING",
        message: "Gmail connection is missing stored credentials.",
        status: 409,
      });
    }

    if (stored.expiryDate && stored.expiryDate - Date.now() > 60_000 && stored.accessToken) {
      return stored;
    }

    if (!stored.refreshToken) {
      throw new ApiError({
        code: "INTEGRATION_RECONNECT_REQUIRED",
        message: "Gmail needs to be reconnected because no refresh token is available.",
        status: 409,
      });
    }

    const oauth = createOAuthClient();
    oauth.setCredentials({
      refresh_token: stored.refreshToken,
      access_token: stored.accessToken,
      expiry_date: stored.expiryDate,
    });

    try {
      const { credentials } = await oauth.refreshAccessToken();
      const refreshed: IntegrationTokenPayload = {
        accessToken: credentials.access_token ?? stored.accessToken,
        refreshToken: credentials.refresh_token ?? stored.refreshToken,
        tokenType: credentials.token_type ?? stored.tokenType,
        scope: credentials.scope ?? stored.scope,
        expiryDate:
          typeof credentials.expiry_date === "number"
            ? credentials.expiry_date
            : stored.expiryDate,
        idToken: credentials.id_token ?? stored.idToken,
      };
      await this.tokenStore.write(connection, refreshed);
      return refreshed;
    } catch (error) {
      await this.tokenStore.markRefreshFailure(connection, "gmail_refresh_failed");
      throw error;
    }
  }

  async getConnectionStatus(connection: IntegrationConnection): Promise<IntegrationConnectionStatus> {
    try {
      const token = await this.tokenStore.read(connection);

      if (!token) {
        return { status: "disconnected", reconnectReason: "No token is stored." };
      }

      if (!token.refreshToken && (!token.accessToken || !token.expiryDate || token.expiryDate < Date.now())) {
        return {
          status: "reconnect_needed",
          reconnectReason: "Refresh token is missing for this Gmail connection.",
          lastErrorCode: connection.lastErrorCode,
        };
      }

      if (
        connection.refreshFailureAt &&
        (!token.refreshToken || !token.expiryDate || token.expiryDate <= Date.now())
      ) {
        return {
          status: "reconnect_needed",
          reconnectReason: "Gmail refresh failed and the connection needs to be reconnected.",
          lastErrorCode: connection.lastErrorCode ?? "gmail_refresh_failed",
        };
      }

      if (token.expiryDate && token.expiryDate <= Date.now()) {
        return { status: "expired", reconnectReason: "Access token expired and needs refresh." };
      }

      return { status: "connected" };
    } catch (error) {
      return {
        status: "error",
        reconnectReason: error instanceof Error ? error.message : "Unable to verify Gmail status.",
        lastErrorCode: "gmail_status_failed",
      };
    }
  }

  async disconnect(connection: IntegrationConnection) {
    const token = await this.tokenStore.read(connection);

    try {
      await this.stopWatch(connection);
    } catch {
      // Best effort only.
    }

    if (token?.accessToken) {
      try {
        await createOAuthClient().revokeToken(token.accessToken);
      } catch {
        // Best effort only. We still clear local state below.
      }
    }

    await this.tokenStore.clear(connection);
  }

  private async getAuthenticatedOAuthClient(connection: IntegrationConnection) {
    const oauth = createOAuthClient();
    const token = await this.refreshAccessTokenIfNeeded(connection);
    oauth.setCredentials({
      access_token: token.accessToken,
      refresh_token: token.refreshToken,
      expiry_date: token.expiryDate,
      token_type: token.tokenType,
      scope: token.scope,
    });
    return oauth;
  }

  private async getAuthenticatedGmailClient(connection: IntegrationConnection) {
    const oauth = await this.getAuthenticatedOAuthClient(connection);
    return google.gmail({ version: "v1", auth: oauth });
  }

  private extractHeader(headers: Array<{ name?: string | null; value?: string | null }> | undefined, name: string) {
    return headers?.find((header) => header.name?.toLowerCase() === name.toLowerCase())?.value ?? "";
  }

  private extractBodyText(payload: GmailPayloadPart | undefined): string {
    if (!payload) {
      return "";
    }

    if (payload.mimeType === "text/plain" && payload.body?.data) {
      return Buffer.from(payload.body.data, "base64").toString("utf8");
    }

    const parts = Array.isArray(payload.parts) ? payload.parts : [];

    for (const part of parts) {
      const text = this.extractBodyText(part);
      if (text.trim()) {
        return text;
      }
    }

    return "";
  }

  private mapThreadMessages(
    threadId: string,
    messages: Array<{
      id?: string | null;
      snippet?: string | null;
      internalDate?: string | null;
      payload?: GmailPayloadPart | null;
    }>,
  ): GmailMessage[] {
    return messages.map((message) => {
      const headers = message.payload?.headers ?? [];
      return {
        id: message.id ?? `${threadId}-message`,
        from: this.extractHeader(headers, "From"),
        to: this.extractHeader(headers, "To")
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
        cc: this.extractHeader(headers, "Cc")
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
        subject: this.extractHeader(headers, "Subject"),
        sentAt:
          normalizeGmailTimestamp(message.internalDate)
          ?? normalizeGmailTimestamp(this.extractHeader(headers, "Date"))
          ?? null,
        snippet: message.snippet ?? "",
        bodyText: this.extractBodyText(message.payload ?? undefined),
      };
    });
  }

  buildThreadListItem(thread: GmailThreadDetail): GmailThreadListItem {
    const datedMessages = [...thread.messages].sort((left, right) => {
      const leftTime = left.sentAt ? new Date(left.sentAt).getTime() : 0;
      const rightTime = right.sentAt ? new Date(right.sentAt).getTime() : 0;
      return rightTime - leftTime;
    });
    const lastMessage = datedMessages[0] ?? thread.messages.at(-1);
    return {
      id: thread.threadId,
      threadId: thread.threadId,
      subject: thread.subject,
      snippet: thread.snippet,
      from: lastMessage?.from ?? thread.participants[0] ?? "",
      lastMessageAt: lastMessage?.sentAt ?? null,
      unread: false,
    };
  }

  async getMailboxProfile(connection: IntegrationConnection): Promise<GmailMailboxProfile> {
    const gmail = await this.getAuthenticatedGmailClient(connection);
    const result = await gmail.users.getProfile({ userId: "me" });

    return {
      emailAddress: result.data.emailAddress ?? "",
      historyId: result.data.historyId ? String(result.data.historyId) : null,
    };
  }

  async setupWatch(connection: IntegrationConnection): Promise<GmailWatchState> {
    if (!env.GMAIL_PUBSUB_TOPIC_NAME) {
      throw new ApiError({
        code: "INTEGRATION_CONFIG_MISSING",
        message: "GMAIL_PUBSUB_TOPIC_NAME is required for Gmail watch setup.",
        status: 500,
      });
    }

    const gmail = await this.getAuthenticatedGmailClient(connection);
    const result = await gmail.users.watch({
      userId: "me",
      requestBody: {
        topicName: env.GMAIL_PUBSUB_TOPIC_NAME,
        labelIds: ["INBOX"],
      },
    });

    return {
      historyId: result.data.historyId ? String(result.data.historyId) : "",
      expiration:
        typeof result.data.expiration === "string"
          ? Timestamp.fromMillis(Number(result.data.expiration))
          : null,
    };
  }

  async renewWatch(connection: IntegrationConnection): Promise<GmailWatchState> {
    return this.setupWatch(connection);
  }

  async stopWatch(connection: IntegrationConnection) {
    const gmail = await this.getAuthenticatedGmailClient(connection);
    await gmail.users.stop({ userId: "me" });
  }

  async listHistory(
    connection: IntegrationConnection,
    input: { startHistoryId: string; pageToken?: string },
  ): Promise<GmailHistoryChangeSet> {
    const gmail = await this.getAuthenticatedGmailClient(connection);
    const result = await gmail.users.history.list({
      userId: "me",
      startHistoryId: input.startHistoryId,
      pageToken: input.pageToken,
      historyTypes: ["messageAdded", "messageDeleted", "labelAdded", "labelRemoved"],
      maxResults: 100,
    });

    const threadIds = new Set<string>();
    const messageIds = new Set<string>();
    const historyEntries = result.data.history ?? [];

    for (const entry of historyEntries) {
      for (const message of entry.messages ?? []) {
        if (message.threadId) {
          threadIds.add(String(message.threadId));
        }
        if (message.id) {
          messageIds.add(String(message.id));
        }
      }

      for (const group of [entry.messagesAdded, entry.messagesDeleted, entry.labelsAdded, entry.labelsRemoved]) {
        for (const item of group ?? []) {
          if (item.message?.threadId) {
            threadIds.add(String(item.message.threadId));
          }
          if (item.message?.id) {
            messageIds.add(String(item.message.id));
          }
        }
      }
    }

    return {
      historyId: result.data.historyId ? String(result.data.historyId) : null,
      changedThreadIds: Array.from(threadIds),
      changedMessageIds: Array.from(messageIds),
      nextPageToken: result.data.nextPageToken ?? null,
    };
  }

  async listRecentInboxThreads(
    connection: IntegrationConnection,
    input: { query?: string; maxResults?: number } = {},
  ): Promise<GmailThreadDetail[]> {
    const gmail = await this.getAuthenticatedGmailClient(connection);
    const list = await gmail.users.threads.list({
      userId: "me",
      q: input.query || undefined,
      labelIds: ["INBOX"],
      maxResults: Math.min(input.maxResults ?? MAX_MANUAL_BACKFILL_THREADS, MAX_MANUAL_BACKFILL_THREADS),
    });

    const threads = list.data.threads ?? [];

    return Promise.all(
      threads
        .filter((thread) => Boolean(thread.id))
        .map(async (thread) => this.getThread(connection, thread.id ?? "")),
    );
  }

  async listSentMessagesForStyle(
    connection: IntegrationConnection,
    input: { sampleSize?: number } = {},
  ): Promise<GmailStyleSampleMessage[]> {
    const gmail = await this.getAuthenticatedGmailClient(connection);
    const sampleSize = Math.min(Math.max(input.sampleSize ?? 25, 1), MAX_STYLE_MESSAGES);
    const list = await gmail.users.messages.list({
      userId: "me",
      labelIds: ["SENT"],
      maxResults: sampleSize,
    });

    const messages = list.data.messages ?? [];
    const detailed = await Promise.all(
      messages
        .filter((message) => Boolean(message.id))
        .slice(0, sampleSize)
        .map(async (message) => {
          const result = await gmail.users.messages.get({
            userId: "me",
            id: message.id ?? "",
            format: "full",
          });
          const mapped = this.mapThreadMessages(
            result.data.threadId ?? message.threadId ?? message.id ?? "sent-message",
            [{
              id: result.data.id,
              snippet: result.data.snippet,
              internalDate: result.data.internalDate,
              payload: result.data.payload as GmailPayloadPart | null | undefined,
            }],
          )[0];

          return {
            id: mapped.id,
            threadId: result.data.threadId ?? message.threadId ?? mapped.id,
            subject: mapped.subject,
            sentAt: mapped.sentAt,
            bodyText: mapped.bodyText || mapped.snippet,
          };
        }),
    );

    return detailed.filter((message) => Boolean(message.bodyText.trim()));
  }

  async listThreads(
    connection: IntegrationConnection,
    input: { query?: string; maxResults?: number } = {},
  ): Promise<GmailThreadListItem[]> {
    const details = await this.listRecentInboxThreads(connection, input);
    return details.map((thread) => this.buildThreadListItem(thread));
  }

  async getThread(connection: IntegrationConnection, threadId: string): Promise<GmailThreadDetail> {
    if (!threadId) {
      throw new ApiError({
        code: "VALIDATION_ERROR",
        message: "A Gmail thread ID is required.",
        status: 400,
      });
    }

    const gmail = await this.getAuthenticatedGmailClient(connection);
    const result = await gmail.users.threads.get({
      userId: "me",
      id: threadId,
      format: "full",
    });

    const messages = this.mapThreadMessages(
      threadId,
      (result.data.messages ?? []).map((message) => ({
        id: message.id,
        snippet: message.snippet,
        internalDate: message.internalDate,
        payload: message.payload as GmailPayloadPart | null | undefined,
      })),
    );
    const participants = Array.from(
      new Set(
        messages.flatMap((message) => [message.from, ...message.to, ...message.cc]).filter(Boolean),
      ),
    );

    return {
      id: threadId,
      threadId,
      subject: messages[0]?.subject ?? result.data.snippet ?? "Untitled Gmail thread",
      snippet: result.data.snippet ?? messages.at(-1)?.snippet ?? "",
      participants,
      messages,
    };
  }

  async createDraft(
    connection: IntegrationConnection,
    input: { to: string[]; cc?: string[]; subject: string; body: string; threadId?: string },
  ) {
    const gmail = await this.getAuthenticatedGmailClient(connection);
    const mime = [
      `To: ${input.to.join(", ")}`,
      input.cc?.length ? `Cc: ${input.cc.join(", ")}` : null,
      `Subject: ${input.subject}`,
      "Content-Type: text/plain; charset=UTF-8",
      "",
      input.body,
    ]
      .filter(Boolean)
      .join("\r\n");

    const result = await gmail.users.drafts.create({
      userId: "me",
      requestBody: {
        message: {
          raw: encodeBase64Url(mime),
          threadId: input.threadId,
        },
      },
    });

    return {
      draftId: result.data.id ?? null,
      messageId: result.data.message?.id ?? null,
    };
  }

  async sendMessage(
    connection: IntegrationConnection,
    input: { to: string[]; cc?: string[]; subject: string; body: string; threadId?: string },
  ) {
    const gmail = await this.getAuthenticatedGmailClient(connection);
    const mime = [
      `To: ${input.to.join(", ")}`,
      input.cc?.length ? `Cc: ${input.cc.join(", ")}` : null,
      `Subject: ${input.subject}`,
      "Content-Type: text/plain; charset=UTF-8",
      "",
      input.body,
    ]
      .filter(Boolean)
      .join("\r\n");

    const result = await gmail.users.messages.send({
      userId: "me",
      requestBody: {
        raw: encodeBase64Url(mime),
        threadId: input.threadId,
      },
    });

    return {
      messageId: result.data.id ?? null,
      threadId: result.data.threadId ?? input.threadId ?? null,
      labelIds: result.data.labelIds ?? [],
    };
  }
}
