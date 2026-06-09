import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { clearActiveIntegrationContext, readActiveIntegrationContext } from "../lib/activeIntegrationContext";

let workspaceData: {
  connection: Record<string, unknown>;
  module: "contacts" | "companies" | "deals" | "notes" | "tasks";
  list: Array<Record<string, unknown>>;
} = {
  connection: {
    id: "hubspot",
    provider: "hubspot",
    status: "connected",
    capabilities: ["crm.read", "crm.write"],
    scopes: [],
    scopesGranted: [],
    lastSyncedAt: null,
    syncError: null,
    ownedByUserId: "user_123",
    connectedBy: "user_123",
    reconnectReason: null,
    lastErrorCode: null,
    accountEmail: null,
    watchStatus: null,
    watchExpiration: null,
    lastDeltaSyncedAt: null,
    fullResyncRequired: false,
  },
  module: "contacts",
  list: [
    {
      id: "contact_1",
      title: "Alex Founder",
      subtitle: "alex@example.com",
      properties: { firstname: "Alex", lastname: "Founder", email: "alex@example.com" },
      updatedAt: null,
    },
  ],
};

const itemDetails: Record<string, Record<string, unknown>> = {
  contact_1: {
    provider: "hubspot",
    module: "contacts",
    detail: {
      id: "contact_1",
      properties: {
        firstname: "Alex",
        lastname: "Founder",
        email: "alex@example.com",
      },
      updatedAt: "2026-05-18T10:00:00.000Z",
    },
    sourceRefs: [],
    contextBundleId: "ctx_hubspot_contact_1",
    selectedContext: {
      provider: "hubspot",
      itemId: "contact_1",
      itemType: "contacts",
      title: "Alex Founder",
      summary: "alex@example.com",
      content: "Record content",
      metadata: {},
    },
  },
};

const runIntegrationActionMock = vi.fn();

vi.mock("../hooks/useAuth", () => ({
  useAuth: () => ({ idToken: "token_123" }),
}));

vi.mock("../components/ui/ToastProvider", () => ({
  useToast: () => ({ pushToast: vi.fn() }),
}));

vi.mock("../hooks/useGideonQueries", () => ({
  useIntegrationWorkspaceQuery: () => ({
    data: workspaceData,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
  useIntegrationItemQuery: (_provider: string, itemId: string | null) => ({
    data: itemId ? itemDetails[itemId] ?? null : null,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

vi.mock("../services/integrations", () => ({
  connectIntegration: vi.fn(),
  disconnectIntegration: vi.fn(),
  syncIntegration: vi.fn(),
  runIntegrationAction: (...args: unknown[]) => runIntegrationActionMock(...args),
}));

import { HubSpotWorkspacePage } from "../components/app-shell/HubSpotWorkspacePage";

describe("HubSpotWorkspacePage", () => {
  beforeEach(() => {
    clearActiveIntegrationContext();
    runIntegrationActionMock.mockReset();
    workspaceData = {
      connection: {
        id: "hubspot",
        provider: "hubspot",
        status: "connected",
        capabilities: ["crm.read", "crm.write"],
        scopes: [],
        scopesGranted: [],
        lastSyncedAt: null,
        syncError: null,
        ownedByUserId: "user_123",
        connectedBy: "user_123",
        reconnectReason: null,
        lastErrorCode: null,
        accountEmail: null,
        watchStatus: null,
        watchExpiration: null,
        lastDeltaSyncedAt: null,
        fullResyncRequired: false,
      },
      module: "contacts",
      list: [
        {
          id: "contact_1",
          title: "Alex Founder",
          subtitle: "alex@example.com",
          properties: { firstname: "Alex", lastname: "Founder", email: "alex@example.com" },
          updatedAt: null,
        },
      ],
    };
  });

  it("renders a not-connected state for disconnected HubSpot workspaces", () => {
    workspaceData = {
      ...workspaceData,
      connection: {
        ...workspaceData.connection,
        status: "disconnected",
      },
      list: [],
    };

    render(<HubSpotWorkspacePage provider="hubspot" />);

    expect(screen.getByText(/Connect HubSpot to browse records/i)).toBeTruthy();
  });

  it("switches modules and stores selected HubSpot record context", async () => {
    render(<HubSpotWorkspacePage provider="hubspot" />);

    fireEvent.click(screen.getByRole("button", { name: "Companies" }));
    expect(screen.getByPlaceholderText(/Search companies/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Tasks" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Notes" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Alex Founder/i }));

    await waitFor(() =>
      expect(readActiveIntegrationContext()).toMatchObject({
        provider: "hubspot",
        itemId: "contact_1",
        contextBundleId: "ctx_hubspot_contact_1",
      }),
    );
    expect(screen.getAllByText("alex@example.com").length).toBeGreaterThan(0);
  });

  it("shows approval-created feedback from the AI sidebar", async () => {
    runIntegrationActionMock.mockResolvedValue({
      approvalId: "approval_1",
    });

    render(<HubSpotWorkspacePage provider="hubspot" />);

    fireEvent.click(screen.getByRole("button", { name: /Alex Founder/i }));
    fireEvent.click(screen.getByRole("button", { name: /Add note/i }));

    await waitFor(() =>
      expect(screen.getByText(/Approval approval_1 created/i)).toBeTruthy(),
    );
  });
});
