import type { Firestore } from "firebase-admin/firestore";

import { ArtifactService } from "../../artifacts/artifactService.js";
import { MemoryService } from "../../memory/memoryService.js";
import { logger } from "../../observability/logger.js";
import type { CurrentWorkspace } from "../../services/currentWorkspaceService.js";
import type { WorkspaceProfile } from "../../schemas/coreSchemas.js";

type ContextPackageOpts = {
  selectedAgentName?: string;
  resolvedMode?: string;
  userProfile?: {
    displayName?: string;
    email?: string;
  };
};

function formatAge(isoDate: string): string {
  const ms = Date.now() - new Date(isoDate).getTime();
  const hours = Math.floor(ms / 3600000);
  if (hours < 1) return "< 1h ago";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return `${Math.floor(days / 7)}w ago`;
}

/**
 * Formats the workspace profile into a prompt-ready identity block.
 * Returns an empty string if no meaningful fields are set.
 */
export function formatWorkspaceIdentityBlock(profile: WorkspaceProfile | undefined): string {
  if (!profile) return "";

  const lines: string[] = [];

  const name = profile.companyName?.trim();
  const oneLiner = profile.oneLiner?.trim();
  const icp = profile.icp?.trim();
  const diff = profile.differentiators?.trim();
  const competitors = profile.primaryCompetitors?.trim();
  const industry = profile.industry?.trim();
  const stage = profile.stage;
  const extra = profile.additionalContext?.trim();

  // Only emit the block if at least one field is filled
  if (!name && !oneLiner && !icp && !diff && !competitors && !industry && !stage && !extra) {
    return "";
  }

  lines.push("=== WORKSPACE IDENTITY ===");
  lines.push(
    "This is authoritative context about the business using Gideon. " +
    "Always treat it as ground truth when personalizing responses."
  );
  if (name)        lines.push(`Company: ${name}`);
  if (oneLiner)    lines.push(`What we do: ${oneLiner}`);
  if (industry)    lines.push(`Industry: ${industry}`);
  if (stage)       lines.push(`Stage: ${stage}`);
  if (icp)         lines.push(`Ideal customer: ${icp}`);
  if (diff)        lines.push(`Key differentiators: ${diff}`);
  if (competitors) lines.push(`Primary competitors: ${competitors}`);
  if (extra)       lines.push(`Additional context: ${extra}`);
  lines.push("=== END WORKSPACE IDENTITY ===");

  return lines.join("\n");
}

export class WorkspaceContextService {
  private readonly artifactService: ArtifactService;
  private readonly memoryService: MemoryService;

  constructor(db: Firestore) {
    this.artifactService = new ArtifactService(db);
    this.memoryService = new MemoryService(db);
  }

  async buildContextPackage(
    currentWorkspace: CurrentWorkspace,
    opts: ContextPackageOpts = {},
  ): Promise<string> {
    const [memoryResult, artifactsResult] = await Promise.allSettled([
      this.memoryService.list(currentWorkspace, { limit: 50 }),
      this.artifactService.listArtifacts(currentWorkspace.workspace, { limit: 10 }),
    ]);

    const lines: string[] = [];

    // Workspace identity — always at the top, never truncated
    const identityBlock = formatWorkspaceIdentityBlock(currentWorkspace.workspace.profile);
    if (identityBlock) {
      lines.push(identityBlock);
      lines.push("");
    }

    // User Profile
    if (opts.userProfile) {
      lines.push("=== USER PROFILE ===");
      lines.push(`Name: ${opts.userProfile.displayName || "Unknown"}`);
      lines.push(`Email: ${opts.userProfile.email || "Unknown"}`);
      lines.push("====================");
      lines.push("");
    }

    lines.push("=== WORKSPACE CONTEXT ===");

    // Workspace profile
    const workspace = currentWorkspace.workspace;
    const sessionMeta = [
      opts.resolvedMode ? `mode: ${opts.resolvedMode}` : null,
      opts.selectedAgentName ? `agent: ${opts.selectedAgentName}` : null,
    ]
      .filter(Boolean)
      .join(" | ");
    lines.push(
      `Workspace: ${workspace.name} | Plan: ${workspace.plan} | Role: ${currentWorkspace.role}${sessionMeta ? ` | ${sessionMeta}` : ""}`,
    );
    lines.push("");

    // Memory — always include top active facts; label unverified ones
    if (memoryResult.status === "fulfilled") {
      const all = memoryResult.value;
      const active = all.filter((n) => n.status === "active");
      const needsReview = all.filter((n) => n.status === "needs_review");
      const topNodes = [...active, ...needsReview].slice(0, 6);

      if (topNodes.length > 0) {
        lines.push("Workspace memory:");
        for (const node of topNodes) {
          const unverifiedTag = node.status === "needs_review" ? " [UNVERIFIED — do not treat as confirmed fact]" : "";
          const lowConfTag = node.confidence < 0.7 && node.status === "active" ? " [low confidence]" : "";
          lines.push(`  [${node.type}] ${node.content.slice(0, 200)}${unverifiedTag}${lowConfTag}`);
        }
        if (active.length > 6) {
          lines.push(`  ...and ${active.length - 6} more active memory facts`);
        }
        lines.push("");
      } else {
        lines.push("Workspace memory: None yet.");
        lines.push("");
      }
    }

    // Recent artifacts — always include most recent, regardless of query relevance
    if (artifactsResult.status === "fulfilled") {
      const recent = artifactsResult.value.slice(0, 5);
      if (recent.length > 0) {
        lines.push("Recent library artifacts:");
        for (const artifact of recent) {
          const age = formatAge(artifact.createdAt);
          const preview = artifact.summary ? ` — ${artifact.summary.slice(0, 120)}` : "";
          lines.push(`  "${artifact.title}" [${artifact.artifactType}] ${age}${preview}`);
        }
        lines.push("");
      } else {
        lines.push("Library artifacts: None yet.");
        lines.push("");
      }
    }

    // Surface any gaps
    const gaps: string[] = [];
    if (memoryResult.status === "rejected") gaps.push("memory unavailable");
    if (artifactsResult.status === "rejected") gaps.push("library unavailable");
    if (gaps.length > 0) {
      lines.push(`Note: ${gaps.join(", ")} — context may be limited.`);
      lines.push("");
    }

    lines.push("=== END WORKSPACE CONTEXT ===");

    const result = lines.join("\n");

    logger.debug("Workspace context package built", {
      workspaceId: currentWorkspace.id,
      charCount: result.length,
      memoryCount: memoryResult.status === "fulfilled" ? memoryResult.value.length : -1,
      artifactCount: artifactsResult.status === "fulfilled" ? artifactsResult.value.length : -1,
    });

    return result;
  }
}
