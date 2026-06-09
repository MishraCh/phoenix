import { ChatPromptTemplate, SystemMessagePromptTemplate, HumanMessagePromptTemplate } from "@langchain/core/prompts";
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

export class PromptCompilerService {
  private readonly resolver: ContextResolverService;

  constructor() {
    this.resolver = new ContextResolverService();
  }

  /**
   * Compiles the standard command orchestration prompt.
   */
  async compileCommandPrompt(input: CommandPromptInput): Promise<CompiledPrompt> {
    const systemTemplate = [
      "{manifest}",
      "{agentAddition}",
      input.workspaceIdentity?.trim() ? "[WORKSPACE IDENTITY]\n{workspaceIdentity}" : null,
      "[MODE-SPECIFIC INSTRUCTION]",
      "Current mode: {mode}",
      "{modeInstructions}",
      "[FORMATTING RULES]",
      "DO NOT include internal citation markers (like 🗯️cite⭐...) or raw source tags in your final output. Your output must be clean markdown ready for a human to read in an email or document.",
      "[TOOL NAMING RULES]",
      "When proposing an approval action, use only registered tool names.",
      "[SAFETY]",
      "Use connected integration context when available, but never claim an external write is completed unless an approval exists and its execution completed successfully."
    ].filter(Boolean).join("\n\n");

    const systemPrompt = SystemMessagePromptTemplate.fromTemplate(systemTemplate);

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
      userParts.push("{assembledContext}");
    }
    userParts.push(`[USER MESSAGE]\n{userRequest}`);
    
    const userPrompt = HumanMessagePromptTemplate.fromTemplate(userParts.join("\n\n"));

    const chatPrompt = ChatPromptTemplate.fromMessages([systemPrompt, userPrompt]);

    const formattedMessages = await chatPrompt.formatMessages({
      manifest: input.manifest,
      agentAddition: input.agentSystemPromptAddition?.trim() ? input.agentSystemPromptAddition.trim() : "",
      workspaceIdentity: input.workspaceIdentity?.trim() ?? "",
      mode: input.mode,
      modeInstructions: input.modeInstructions,
      userRequest: input.userRequest,
      assembledContext: resolvedContext.assembled.trim() ? resolvedContext.assembled.trim() : "",
    });

    logger.debug("PromptCompiler: compiled command prompt", {
      resolvedSizes: ContextResolverService.formatSizeLog(resolvedContext.sizes),
      totalContextChars: resolvedContext.totalChars,
    });

    return {
      systemPrompt: formattedMessages[0].content as string,
      userPrompt: formattedMessages[1].content as string,
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

    const systemTemplate = [
      "[GIDEON EXPERT MODE]",
      "{expertSystem}",
      input.workspaceIdentity?.trim() ? "[WORKSPACE IDENTITY]\nUse this to personalize the expert analysis for this specific business:\n{workspaceIdentity}" : null,
      "[FORMATTING RULES]",
      "DO NOT include internal citation markers (like 🗯️cite⭐...) or raw source tags in your final output. Your output must be clean markdown ready for a human to read in an email or document.",
      "[SAFETY]",
      "Never invent CRM, email, or research facts that are not present in the supplied context.",
      "If evidence is weak, say so directly and lower confidence.",
      "Do not convert this into an external action unless the user explicitly asks and the normal approval flow is used elsewhere."
    ].filter(Boolean).join("\n\n");

    const systemPrompt = SystemMessagePromptTemplate.fromTemplate(systemTemplate);

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
      userParts.push("{assembledContext}");
    }

    if (input.missingContext?.length) {
      userParts.push(`[KNOWN CONTEXT GAPS]\n{missingContextStr}`);
    }

    userParts.push(`[TASK]\n{task}`);
    userParts.push(`[USER MESSAGE]\n{userRequest}`);

    const userPrompt = HumanMessagePromptTemplate.fromTemplate(userParts.join("\n\n"));

    const chatPrompt = ChatPromptTemplate.fromMessages([systemPrompt, userPrompt]);

    const formattedMessages = await chatPrompt.formatMessages({
      expertSystem: definition.system.trim(),
      task: definition.userTask,
      userRequest: input.userRequest,
      workspaceIdentity: input.workspaceIdentity?.trim() ?? "",
      assembledContext: resolvedContext.assembled.trim() ? resolvedContext.assembled.trim() : "",
      missingContextStr: input.missingContext?.length ? input.missingContext.join(", ") : "",
    });

    logger.debug("PromptCompiler: compiled expert prompt", {
      expertType: input.expertType,
      resolvedSizes: ContextResolverService.formatSizeLog(resolvedContext.sizes),
      totalContextChars: resolvedContext.totalChars,
    });

    return {
      systemPrompt: formattedMessages[0].content as string,
      userPrompt: formattedMessages[1].content as string,
      sizes: resolvedContext.sizes,
      totalChars: resolvedContext.totalChars,
    };
  }
}
