import { describe, it, expect } from "vitest";
import { shouldUseToolLoop } from "../command/commandRouting.js";

/**
 * Documents + verifies which engine handles each UI command mode:
 *  - ToolLoopAgent (autonomous, multi-step): auto, research, and the default (no mode).
 *  - Deterministic single-pass pipeline: search, extract_url, workflow.
 *  - Flag off => everything uses the deterministic pipeline.
 */
describe("command routing — which engine handles each mode", () => {
  describe("with AGENTIC_TOOLLOOP_V1 enabled", () => {
    const agentic = true;

    it("routes AUTO mode to the agent (default conversational/agentic surface)", () => {
      expect(shouldUseToolLoop("auto", agentic)).toBe(true);
    });

    it("routes RESEARCH mode to the agent (deep, multi-step, source-backed)", () => {
      expect(shouldUseToolLoop("research", agentic)).toBe(true);
    });

    it("routes the DEFAULT (no explicit mode) to the agent", () => {
      expect(shouldUseToolLoop(undefined, agentic)).toBe(true);
    });

    it("routes SEARCH mode to the deterministic pipeline (scoped quick lookup)", () => {
      expect(shouldUseToolLoop("search", agentic)).toBe(false);
    });

    it("routes EXTRACT_URL mode to the deterministic pipeline (read a known URL)", () => {
      expect(shouldUseToolLoop("extract_url", agentic)).toBe(false);
    });

    it("routes WORKFLOW mode to the deterministic pipeline (build an automation)", () => {
      expect(shouldUseToolLoop("workflow", agentic)).toBe(false);
    });
  });

  describe("with AGENTIC_TOOLLOOP_V1 disabled", () => {
    const agentic = false;

    it.each(["auto", "research", "search", "extract_url", "workflow", undefined])(
      "routes %s to the deterministic pipeline when the flag is off",
      (mode) => {
        expect(shouldUseToolLoop(mode, agentic)).toBe(false);
      },
    );
  });
});
