import { ContextResolverService, type ContextResolverInput } from "../context/contextResolverService.js";
import { logger } from "../../observability/logger.js";
import type { ExpertTypeId } from "../../experts/types.js";
import { marketResearchPrompts } from "../../experts/groups/marketResearch.js";
import { opportunityAnalysisPrompts } from "../../experts/groups/opportunityAnalysis.js";
import { outreachMessagingPrompts } from "../../experts/groups/outreachMessaging.js";
import { salesIntelligencePrompts } from "../../experts/groups/salesIntelligence.js";

const promptDefinitions = {
  ...salesIntelligencePrompts,
  ...opportunityAnalysisPrompts,
  ...outreachMessagingPrompts,
  ...marketResearchPrompts,
};

export type CommandPromptInput = {
  manifest: string;
  agentSystemPromptAddition?: string | null;
  mode: string;
  modeInstructions: string;
  missingContext?: string[];
  /** Formatted workspace identity block from WorkspaceProfile, if set */
  workspaceIdentity?: string;
} & ContextResolverInput;

export type ExpertPromptInput = {
  expertType: ExpertTypeId;
  missingContext?: string[];
  /** Formatted workspace identity block from WorkspaceProfile, if set */
  workspaceIdentity?: string;
} & ContextResolverInput;

export type CompiledPrompt = {
  systemPrompt: string;
  userPrompt: string;
  sizes: Record<string, number>;
  totalChars: number;
};

/** Join prompt segments the way the prior ChatPromptTemplate did: keep empty
 *  substituted segments (e.g. an empty agent addition), drop only null lines. */
function joinSegments(parts: Array<string | null>): string {
  return parts.filter((part) => part !== null).join("\n\n");
}

export class PromptCompilerService {
  private readonly resolver: ContextResolverService;

  constructor() {
    this.resolver = new ContextResolverService();
  }

  /**
   * Compiles the standard command orchestration prompt.
   */
  async compileCommandPrompt(input: CommandPromptInput): Promise<CompiledPrompt> {
    const agentAddition = input.agentSystemPromptAddition?.trim()
      ? input.agentSystemPromptAddition.trim()
      : "";

    const systemPrompt = joinSegments([
      input.manifest,
      agentAddition,
      input.workspaceIdentity?.trim()
        ? `[WORKSPACE IDENTITY]\n${input.workspaceIdentity.trim()}`
        : null,
      "[MODE-SPECIFIC INSTRUCTION]",
      `Current mode: ${input.mode}`,
      input.modeInstructions,
      "[FORMATTING RULES]",
      "DO NOT include internal citation markers (like 🗯️cite⭐...) or raw source tags in your final output. Your output must be clean markdown ready for a human to read in an email or document.",
      "[TOOL NAMING RULES]",
      "When proposing an approval action, use only registered tool names.",
      "[SAFETY]",
      "Use connected integration context when available, but never claim an external write is completed unless an approval exists and its execution completed successfully.",
    ]);

    const resolvedContext = this.resolver.resolve({
      selectedItemContext: input.selectedItemContext,
      sessionSummary: input.sessionSummary,
      retrievedContext: input.retrievedContext,
      expertSopText: input.expertSopText,
      memoryContext: input.memoryContext,
      toolResult: input.toolResult,
      userRequest: input.userRequest,
    });

    const userParts: string[] = [];
    if (resolvedContext.assembled.trim()) {
      userParts.push(resolvedContext.assembled.trim());
    }
    userParts.push(`[USER MESSAGE]\n${input.userRequest}`);
    const userPrompt = userParts.join("\n\n");

    logger.debug("PromptCompiler: compiled command prompt", {
      resolvedSizes: ContextResolverService.formatSizeLog(resolvedContext.sizes),
      totalContextChars: resolvedContext.totalChars,
    });

    return {
      systemPrompt,
      userPrompt,
      sizes: resolvedContext.sizes,
      totalChars: resolvedContext.totalChars,
    };
  }

  /**
   * Compiles an expert capability prompt.
   */
  async compileExpertPrompt(input: ExpertPromptInput): Promise<CompiledPrompt> {
    const definition = promptDefinitions[input.expertType];
    if (!definition) {
      throw new Error(`PromptCompiler: Missing expert prompt definition for ${input.expertType}`);
    }

    const systemPrompt = joinSegments([
      "[GIDEON EXPERT MODE]",
      definition.system.trim(),
      input.workspaceIdentity?.trim()
        ? `[WORKSPACE IDENTITY]\nUse this to personalize the expert analysis for this specific business:\n${input.workspaceIdentity.trim()}`
        : null,
      "[FORMATTING RULES]",
      "DO NOT include internal citation markers (like 🗯️cite⭐...) or raw source tags in your final output. Your output must be clean markdown ready for a human to read in an email or document.",
      "[SAFETY]",
      "Never invent CRM, email, or research facts that are not present in the supplied context.",
      "If evidence is weak, say so directly and lower confidence.",
      "Do not convert this into an external action unless the user explicitly asks and the normal approval flow is used elsewhere.",
    ]);

    const resolvedContext = this.resolver.resolve({
      selectedItemContext: input.selectedItemContext,
      sessionSummary: input.sessionSummary,
      retrievedContext: input.retrievedContext,
      expertSopText: input.expertSopText,
      memoryContext: input.memoryContext,
      toolResult: input.toolResult,
      userRequest: input.userRequest,
    });

    const userParts: string[] = [];
    if (resolvedContext.assembled.trim()) {
      userParts.push(resolvedContext.assembled.trim());
    }
    if (input.missingContext?.length) {
      userParts.push(`[KNOWN CONTEXT GAPS]\n${input.missingContext.join(", ")}`);
    }
    userParts.push(`[TASK]\n${definition.userTask}`);
    userParts.push(`[USER MESSAGE]\n${input.userRequest}`);
    const userPrompt = userParts.join("\n\n");

    logger.debug("PromptCompiler: compiled expert prompt", {
      expertType: input.expertType,
      resolvedSizes: ContextResolverService.formatSizeLog(resolvedContext.sizes),
      totalContextChars: resolvedContext.totalChars,
    });

    return {
      systemPrompt,
      userPrompt,
      sizes: resolvedContext.sizes,
      totalChars: resolvedContext.totalChars,
    };
  }
}
