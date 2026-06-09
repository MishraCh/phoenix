import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { legacyArchiveInventory } from "../experts/archiveInventory.js";

function collectSourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return collectSourceFiles(fullPath);
    }
    if (/\.(ts|tsx)$/.test(entry.name)) {
      return [fullPath];
    }
    return [];
  });
}

const currentDir = path.dirname(fileURLToPath(import.meta.url));

describe("legacyArchiveInventory", () => {
  it("contains typed keep/merge entries with provenance", () => {
    expect(legacyArchiveInventory.length).toBeGreaterThan(10);
    for (const entry of legacyArchiveInventory) {
      expect(entry.id).toBeTruthy();
      expect(entry.displayName).toBeTruthy();
      expect(entry.sourceFiles.length).toBeGreaterThan(0);
      expect(entry.mappedAgents.length).toBeGreaterThan(0);
      expect(entry.expectedInputs.length).toBeGreaterThan(0);
      expect(entry.expectedOutputs.length).toBeGreaterThan(0);
    }
  });

  it("does not read or import the root tools archive from production code", () => {
    const repoRoot = path.resolve(currentDir, "../../..");
    const productionRoots = [
      path.join(repoRoot, "backend", "src"),
      path.join(repoRoot, "frontend", "services"),
      path.join(repoRoot, "frontend", "components"),
    ];

    const sourceFiles = productionRoots.flatMap((root) => collectSourceFiles(root));
    for (const filePath of sourceFiles) {
      const content = fs.readFileSync(filePath, "utf8");
      expect(content).not.toMatch(/tools\/.*\.html/);
      expect(content).not.toMatch(/tools\/xlegal-tool-server/);
      expect(content).not.toMatch(/tools\/START_Signal_Scout/);
    }
  });
});
