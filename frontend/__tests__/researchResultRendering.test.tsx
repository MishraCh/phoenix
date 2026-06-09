import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CommandResponseBody } from "../components/app-shell/command-center/CommandResponseBody";
import type { CommandResponse } from "../services/command";

function researchResponse(): CommandResponse {
  return {
    answer: "Validated partial findings.",
    agentRunId: "run_research",
    resolvedMode: "search",
    resultType: "search",
    result: {
      kind: "search",
      summary: "Validated partial findings.",
      highlights: [],
      sections: [],
      provider: "openai_graph",
      confidence: 0.62,
      completeness: 0.5,
      freshness: "partial",
      failedSources: ["synthesis:AbortError"],
      partialResult: true,
    },
    proposedActions: [],
    artifactDrafts: [],
    sources: [
      {
        sourceType: "web",
        sourceId: "source_1",
        title: "Funding announcement",
        url: "https://example.com/funding",
      },
    ],
    missingContext: [],
    creditsCharged: 1,
    sessionId: "session_1",
    partialResult: {
      completeness: 0.5,
      confidence: 0.62,
      freshness: "partial",
      failedSources: ["synthesis:AbortError"],
    },
  };
}

describe("research result rendering", () => {
  it("shows partial-result metadata and keeps citations clickable", () => {
    render(
      <CommandResponseBody
        response={researchResponse()}
        messageId="message_1"
      />,
    );

    expect(screen.getByText(/Partial research result/i)).toBeInTheDocument();
    expect(screen.getByText(/62% confidence/i)).toBeInTheDocument();
    expect(screen.getByText(/Unavailable: synthesis:AbortError/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /example\.com/i })).toHaveAttribute(
      "href",
      "https://example.com/funding",
    );
  });
});
