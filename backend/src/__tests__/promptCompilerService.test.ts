import { describe, it, expect } from "vitest";
import { PromptCompilerService } from "../ai/prompts/promptCompilerService.js";

describe("PromptCompilerService", () => {
  it("compiles a command prompt with system + user strings containing the manifest and request", async () => {
    const svc = new PromptCompilerService();
    const out = await svc.compileCommandPrompt({
      manifest: "MANIFEST_BLOCK",
      mode: "auto",
      modeInstructions: "MODE_RULES",
      userRequest: "Find AI infra companies",
      retrievedContext: "CTX_BLOCK",
    } as never);
    expect(typeof out.systemPrompt).toBe("string");
    expect(typeof out.userPrompt).toBe("string");
    expect(out.systemPrompt).toContain("MANIFEST_BLOCK");
    expect(out.systemPrompt).toContain("Current mode: auto");
    expect(out.systemPrompt).toContain("MODE_RULES");
    expect(out.userPrompt).toContain("Find AI infra companies");
    expect(out.userPrompt).toContain("[USER MESSAGE]");
  });

  it("includes a workspace identity block when provided", async () => {
    const svc = new PromptCompilerService();
    const out = await svc.compileCommandPrompt({
      manifest: "M",
      mode: "search",
      modeInstructions: "R",
      userRequest: "q",
      workspaceIdentity: "Acme Inc, B2B SaaS",
    } as never);
    expect(out.systemPrompt).toContain("[WORKSPACE IDENTITY]");
    expect(out.systemPrompt).toContain("Acme Inc, B2B SaaS");
  });
});
