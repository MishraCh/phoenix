import type { Timestamp } from "firebase-admin/firestore";

import type {
  Integration,
  IntegrationProviderId,
  IntegrationStatus,
  SourceRef,
} from "../../schemas/coreSchemas.js";

export type OAuthStatePayload = {
  workspaceId: string;
  userId: string;
  provider: IntegrationProviderId;
  createdAt: number;
};

export type IntegrationTokenPayload = {
  accessToken?: string;
  refreshToken?: string;
  tokenType?: string;
  scope?: string;
  expiryDate?: number;
  idToken?: string;
  raw?: Record<string, unknown>;
};

export type IntegrationConnection = Integration & {
  encryptedToken?: string;
};

export type IntegrationConnectContext = {
  workspaceId: string;
  userId: string;
};

export type IntegrationConnectResult = {
  authUrl: string;
};

export type IntegrationExchangeResult = {
  status: IntegrationStatus;
  scopes: string[];
  capabilities: string[];
  tokenPayload: IntegrationTokenPayload;
  tokenExpiresAt?: Timestamp;
  metadata?: Record<string, unknown>;
};

export type IntegrationConnectionStatus = {
  status: IntegrationStatus;
  reconnectReason?: string;
  lastErrorCode?: string;
};

export type SelectedItemContext = {
  provider: IntegrationProviderId;
  itemId: string;
  itemType: string;
  title: string;
  summary: string;
  content: string;
  metadata?: Record<string, unknown>;
  sourceRefs: SourceRef[];
};

export type IntegrationContextBlock = {
  provider: IntegrationProviderId;
  status: IntegrationStatus;
  title: string;
  selectedItem?: SelectedItemContext;
  limitations: string[];
};

export type IntegrationActionRequest = {
  provider: IntegrationProviderId;
  actionType: string;
  targetId: string;
  targetType: string;
  title: string;
  preview: Record<string, unknown>;
  payload: Record<string, unknown>;
};

export interface IntegrationProvider {
  readonly id: IntegrationProviderId;
  readonly displayName: string;
  readonly defaultCapabilities: string[];

  getRequiredScopes(): string[];
  getConnectUrl(context: IntegrationConnectContext): Promise<IntegrationConnectResult>;
  exchangeCode(input: { code: string; state: string }): Promise<IntegrationExchangeResult>;
  refreshAccessTokenIfNeeded(connection: IntegrationConnection): Promise<IntegrationTokenPayload>;
  getConnectionStatus(connection: IntegrationConnection): Promise<IntegrationConnectionStatus>;
  disconnect(connection: IntegrationConnection): Promise<void>;
}
