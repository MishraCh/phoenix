import { describe, it, expect, vi, beforeEach } from "vitest";

const pollMock = vi.fn();
const itemsMock = vi.fn();
vi.mock("../web/providers/exaWebsetsProvider.js", () => ({
  ExaWebsetsProvider: class {
    poll = pollMock;
    items = itemsMock;
  },
}));

const getWorkspaceMock = vi.fn();
vi.mock("../repositories/workspaceRepository.js", () => ({
  WorkspaceRepository: class {
    getWorkspace = getWorkspaceMock;
  },
}));

const createArtifactMock = vi.fn();
vi.mock("../artifacts/artifactService.js", () => ({
  ArtifactService: class {
    createArtifact = createArtifactMock;
  },
}));

const createNotificationMock = vi.fn();
vi.mock("../notifications/notificationService.js", () => ({
  NotificationService: class {
    createNotification = createNotificationMock;
  },
}));

import { processExaWebset } from "../jobs/exaTaskProcessor.js";

const job = {
  workspaceId: "w1",
  payload: { userId: "u1", input: { websetId: "ws1", label: "AI infra companies", entity: "company", query: "AI infra" } },
} as never;

describe("processExaWebset", () => {
  beforeEach(() => {
    pollMock.mockReset();
    itemsMock.mockReset();
    getWorkspaceMock.mockReset();
    createArtifactMock.mockReset();
    createNotificationMock.mockReset();
    getWorkspaceMock.mockResolvedValue({ id: "w1", name: "Acme WS" });
    createArtifactMock.mockResolvedValue({ id: "art_1" });
  });

  it("polls until idle, builds a dataset artifact, and notifies", async () => {
    pollMock.mockResolvedValueOnce({ status: "running", idle: false }).mockResolvedValueOnce({ status: "idle", idle: true });
    itemsMock.mockResolvedValue([
      { id: "i1", properties: { name: "Acme AI", url: "https://acme.ai" }, enrichments: { "Total funding": "$12M" }, sourceRefs: [{ sourceType: "web", sourceId: "s1", url: "https://acme.ai", provider: "exa_websets" }] },
      { id: "i2", properties: { name: "Beta AI" }, enrichments: { "Total funding": "$5M" }, sourceRefs: [] },
    ]);

    const result = await processExaWebset({} as never, job, { pollIntervalMs: 1, maxPolls: 5 });

    expect(createArtifactMock).toHaveBeenCalledTimes(1);
    const artifactArg = createArtifactMock.mock.calls[0][0] as { artifactType: string; content: string; title: string };
    expect(artifactArg.artifactType).toBe("data");
    expect(artifactArg.title).toBe("AI infra companies");
    const dataset = JSON.parse(artifactArg.content) as { kind: string; rows: unknown[]; columns: Array<{ key: string }> };
    expect(dataset.kind).toBe("dataset");
    expect(dataset.rows).toHaveLength(2);
    expect(dataset.columns.some((c) => c.key === "Total funding")).toBe(true);

    expect(createNotificationMock).toHaveBeenCalledTimes(1);
    const notifyArg = createNotificationMock.mock.calls[0][0] as { type: string };
    expect(notifyArg.type).toBe("report_ready");
    expect(result.resultRef).toContain("art_1");
  });

  it("sends a failure notification when the webset never becomes idle", async () => {
    pollMock.mockResolvedValue({ status: "running", idle: false });
    await processExaWebset({} as never, job, { pollIntervalMs: 1, maxPolls: 2 });
    expect(createArtifactMock).not.toHaveBeenCalled();
    expect(createNotificationMock).toHaveBeenCalledTimes(1);
  });
});
