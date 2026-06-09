import { apiFetch } from "./apiClient";

export type IntegrationStatus =
  | "connected"
  | "expired"
  | "reconnect_needed"
  | "disconnected"
  | "syncing"
  | "error";

export type IntegrationListItem = {
  id: string;
  provider: string;
  status: IntegrationStatus;
  capabilities: string[];
  scopes: string[];
  scopesGranted: string[];
  lastSyncedAt: string | null;
  syncError: string | null;
  ownedByUserId: string | null;
  connectedBy: string;
  reconnectReason: string | null;
  lastErrorCode: string | null;
  accountEmail: string | null;
  watchStatus: "pending" | "active" | "expired" | "error" | null;
  watchExpiration: string | null;
  lastDeltaSyncedAt: string | null;
  fullResyncRequired: boolean;
  access?: "owner" | "restricted";
  ownerOnly?: boolean;
};

export type IntegrationDetail = IntegrationListItem & {
  items: Array<{
    id: string;
    sourceType: string;
    title: string | null;
    summary: string | null;
    lastSyncedAt: string;
    sourceHash: string;
  }>;
};

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
  messages: Array<{
    id: string;
    from: string;
    to: string[];
    cc: string[];
    subject: string;
    sentAt: string | null;
    snippet: string;
    bodyText: string;
  }>;
};

export type HubSpotRecordListItem = {
  id: string;
  title: string;
  subtitle: string;
  properties: Record<string, unknown>;
  updatedAt: string | null;
};

export type HubSpotModule = "contacts" | "companies" | "deals" | "notes" | "tasks";

export type HubSpotRelatedRecord = {
  id: string;
  module: HubSpotModule;
  title: string;
  subtitle: string;
  properties: Record<string, unknown>;
  updatedAt: string | null;
};

export type HubSpotRecordDetail = {
  id: string;
  title?: string;
  summary?: string;
  properties?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
  archived?: boolean;
  associations?: {
    companies?: HubSpotRelatedRecord[];
    contacts?: HubSpotRelatedRecord[];
    deals?: HubSpotRelatedRecord[];
  };
  relatedNotes?: HubSpotRelatedRecord[];
  relatedTasks?: HubSpotRelatedRecord[];
};

export type SelectedIntegrationContext = {
  provider: string;
  itemId: string;
  itemType: string;
  title: string;
  summary: string;
  content: string;
  metadata?: Record<string, unknown>;
};

export type GmailStyleProfile = {
  id: string;
  workspaceId: string;
  userId: string;
  sampleSize: number;
  tone: string;
  formality: string;
  greetingStyle: string;
  signOffStyle: string;
  sentenceLength: string;
  commonPhrasing: string[];
  doPreferences: string[];
  dontPreferences: string[];
  summary: string;
  createdAt: string;
  updatedAt: string;
};

export type GmailWorkspaceData = {
  provider: "gmail";
  connection: IntegrationDetail | IntegrationListItem;
  list: GmailThreadListItem[];
};

export type HubSpotWorkspaceData = {
  provider: "hubspot";
  connection: IntegrationDetail | IntegrationListItem;
  module: HubSpotModule;
  list: HubSpotRecordListItem[];
};

export type GmailItemDetailResponse = {
  provider: "gmail";
  detail: GmailThreadDetail;
  sourceRefs: Array<Record<string, unknown>>;
  contextBundleId: string;
  selectedContext: SelectedIntegrationContext;
};

export type HubSpotItemDetailResponse = {
  provider: "hubspot";
  module: HubSpotModule;
  detail: HubSpotRecordDetail;
  sourceRefs: Array<Record<string, unknown>>;
  contextBundleId: string;
  selectedContext: SelectedIntegrationContext;
};

export const fallbackIntegrations: IntegrationListItem[] = [
  {
    id: "gmail",
    provider: "gmail",
    status: "disconnected",
    capabilities: ["email.read", "email.draft", "email.send"],
    scopes: [],
    scopesGranted: [],
    lastSyncedAt: null,
    syncError: null,
    ownedByUserId: null,
    connectedBy: "",
    reconnectReason: null,
    lastErrorCode: null,
    accountEmail: null,
    watchStatus: null,
    watchExpiration: null,
    lastDeltaSyncedAt: null,
    fullResyncRequired: false,
  },
  {
    id: "hubspot",
    provider: "hubspot",
    status: "disconnected",
    capabilities: ["crm.read", "crm.write"],
    scopes: [],
    scopesGranted: [],
    lastSyncedAt: null,
    syncError: null,
    ownedByUserId: null,
    connectedBy: "",
    reconnectReason: null,
    lastErrorCode: null,
    accountEmail: null,
    watchStatus: null,
    watchExpiration: null,
    lastDeltaSyncedAt: null,
    fullResyncRequired: false,
  },
];

export function fetchIntegrations(firebaseIdToken: string) {
  return apiFetch<{ integrations: IntegrationListItem[] }>("/integrations", {
    firebaseIdToken,
    method: "GET",
  });
}

export function fetchIntegrationDetail(firebaseIdToken: string, provider: string) {
  return apiFetch<IntegrationDetail>(`/integrations/${provider}`, {
    firebaseIdToken,
    method: "GET",
  });
}

export function fetchIntegrationWorkspace(
  firebaseIdToken: string,
  provider: string,
  options?: { q?: string; module?: HubSpotModule },
) {
  const params = new URLSearchParams();
  if (options?.q) params.set("q", options.q);
  if (options?.module) params.set("module", options.module);
  const query = params.toString();

  return apiFetch<GmailWorkspaceData | HubSpotWorkspaceData>(
    `/integrations/${provider}/workspace${query ? `?${query}` : ""}`,
    {
      firebaseIdToken,
      method: "GET",
    },
  );
}

export function fetchIntegrationItemDetail(
  firebaseIdToken: string,
  provider: string,
  itemId: string,
  options?: { module?: HubSpotModule },
) {
  const params = new URLSearchParams();
  if (options?.module) params.set("module", options.module);
  const query = params.toString();

  return apiFetch<GmailItemDetailResponse | HubSpotItemDetailResponse>(
    `/integrations/${provider}/items/${itemId}${query ? `?${query}` : ""}`,
    {
      firebaseIdToken,
      method: "GET",
    },
  );
}

export function connectIntegration(firebaseIdToken: string, provider: string) {
  return apiFetch<{ authUrl: string }>(`/integrations/${provider}/connect`, {
    firebaseIdToken,
    method: "POST",
  });
}

export function disconnectIntegration(firebaseIdToken: string, provider: string) {
  return apiFetch<{ status: string }>(`/integrations/${provider}/disconnect`, {
    firebaseIdToken,
    method: "POST",
  });
}

export function syncIntegration(firebaseIdToken: string, provider: string) {
  return apiFetch<{ status: string; jobId: string }>(`/integrations/${provider}/sync`, {
    firebaseIdToken,
    method: "POST",
  });
}

export function runIntegrationAction<TResponse>(
  firebaseIdToken: string,
  provider: string,
  action: string,
  payload: Record<string, unknown>,
) {
  return apiFetch<TResponse>(`/integrations/${provider}/actions/${action}`, {
    firebaseIdToken,
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function fetchGmailStyleProfile(firebaseIdToken: string) {
  return apiFetch<{ profile: GmailStyleProfile | null }>("/integrations/gmail/style-profile", {
    firebaseIdToken,
    method: "GET",
  });
}

export function analyzeGmailStyleProfile(firebaseIdToken: string, sampleSize?: number) {
  return apiFetch<{ profile: GmailStyleProfile }>("/integrations/gmail/style-profile/analyze", {
    firebaseIdToken,
    method: "POST",
    body: JSON.stringify(sampleSize ? { sampleSize } : {}),
  });
}

export function deleteGmailStyleProfile(firebaseIdToken: string) {
  return apiFetch<{ deleted: boolean }>("/integrations/gmail/style-profile", {
    firebaseIdToken,
    method: "DELETE",
  });
}
