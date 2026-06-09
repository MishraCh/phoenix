import { describe, it, expect } from "vitest";
import { parseSlashMode } from "../ai/graphs/commandGraphUtils.js";


describe("parseSlashMode", () => {
  it("returns null mode for plain input", () => {
    const result = parseSlashMode("what is the weather today");
    expect(result.mode).toBeNull();
    expect(result.normalizedInput).toBe("what is the weather today");
  });

  it("parses /search prefix", () => {
    const result = parseSlashMode("/search best productivity tools");
    expect(result.mode).toBe("search");
    expect(result.normalizedInput).toBe("best productivity tools");
  });

  it("parses /research prefix", () => {
    const result = parseSlashMode("/research competitor analysis");
    expect(result.mode).toBe("research");
    expect(result.normalizedInput).toBe("competitor analysis");
  });

  it("parses /extract and maps to extract_url", () => {
    const result = parseSlashMode("/extract https://example.com");
    expect(result.mode).toBe("extract_url");
    expect(result.normalizedInput).toBe("https://example.com");
  });

  it("parses /workflow prefix", () => {
    const result = parseSlashMode("/workflow send daily brief");
    expect(result.mode).toBe("workflow");
    expect(result.normalizedInput).toBe("send daily brief");
  });

  it("is case-insensitive", () => {
    expect(parseSlashMode("/SEARCH query").mode).toBe("search");
    expect(parseSlashMode("/Research topic").mode).toBe("research");
  });

  it("handles leading whitespace before slash", () => {
    const result = parseSlashMode("  /search query");
    expect(result.mode).toBe("search");
  });
});
