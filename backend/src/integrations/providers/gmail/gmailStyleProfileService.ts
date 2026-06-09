import { Timestamp, type Firestore } from "firebase-admin/firestore";
import { z } from "zod";

import { createLlmProvider } from "../../../ai/providers/providerRegistry.js";
import { gmailStyleProfileSchema, type GmailStyleProfile } from "../../../schemas/coreSchemas.js";
import type { CurrentWorkspace } from "../../../services/currentWorkspaceService.js";
import { ApiError } from "../../../utils/apiError.js";
import { IntegrationService } from "../../integrationService.js";
import { GmailProvider } from "./gmailProvider.js";

const styleProfileOutputSchema = z.object({
  tone: z.string().min(1),
  formality: z.string().min(1),
  greetingStyle: z.string().min(1),
  signOffStyle: z.string().min(1),
  sentenceLength: z.string().min(1),
  commonPhrasing: z.array(z.string()).default([]),
  doPreferences: z.array(z.string()).default([]),
  dontPreferences: z.array(z.string()).default([]),
  summary: z.string().min(1),
});

function collection(db: Firestore, workspaceId: string) {
  return db.collection("workspaces").doc(workspaceId).collection("gmailStyleProfiles");
}

export class GmailStyleProfileService {
  private readonly integrationService: IntegrationService;
  private readonly provider: GmailProvider;

  constructor(private readonly db: Firestore) {
    this.integrationService = new IntegrationService(db);
    this.provider = new GmailProvider(db);
  }

  async getProfile(workspaceId: string, userId: string): Promise<GmailStyleProfile | null> {
    const snapshot = await collection(this.db, workspaceId).doc(userId).get();

    if (!snapshot.exists) {
      return null;
    }

    return gmailStyleProfileSchema.parse({ id: snapshot.id, ...snapshot.data() });
  }

  async analyzeProfile(currentWorkspace: CurrentWorkspace, userId: string, sampleSize = 25) {
    const boundedSampleSize = Math.min(Math.max(sampleSize, 1), 50);
    const connection = await this.integrationService.requireConnection(currentWorkspace, "gmail");
    const messages = await this.provider.listSentMessagesForStyle(connection, {
      sampleSize: boundedSampleSize,
    });

    if (messages.length === 0) {
      throw new ApiError({
        code: "NO_GMAIL_SENT_MESSAGES",
        message: "No sent Gmail messages were available to build a writing style profile.",
        status: 409,
      });
    }

    const llm = createLlmProvider();
    const promptBody = messages
      .slice(0, boundedSampleSize)
      .map((message, index) =>
        [
          `Message ${index + 1}`,
          `Subject: ${message.subject}`,
          `Sent: ${message.sentAt ?? "Unknown"}`,
          message.bodyText,
        ].join("\n"),
      )
      .join("\n\n---\n\n");

    const profile = await llm.generateStructured({
      schema: styleProfileOutputSchema,
      systemPrompt:
        "Analyze the user's sent-email writing style. Return a compact reusable style profile. " +
        "Focus on tone, formality, structure, recurring phrasing, and do/don't preferences. " +
        "Do not include raw email text in the output.",
      userPrompt: `Build a writing style profile from these sent Gmail samples.\n\n${promptBody}`,
    });

    const now = Timestamp.now();
    const stored = gmailStyleProfileSchema.parse({
      id: userId,
      workspaceId: currentWorkspace.id,
      userId,
      sampleSize: Math.min(messages.length, boundedSampleSize),
      ...profile,
      createdAt: now,
      updatedAt: now,
    });

    await collection(this.db, currentWorkspace.id).doc(userId).set(stored);
    return stored;
  }

  async deleteProfile(workspaceId: string, userId: string) {
    await collection(this.db, workspaceId).doc(userId).delete();
  }

  buildPromptBlock(profile: GmailStyleProfile | null) {
    if (!profile) {
      return "";
    }

    return [
      "Use the user's established Gmail writing style when drafting the reply.",
      `Tone: ${profile.tone}`,
      `Formality: ${profile.formality}`,
      `Greeting style: ${profile.greetingStyle}`,
      `Sign-off style: ${profile.signOffStyle}`,
      `Sentence length: ${profile.sentenceLength}`,
      profile.commonPhrasing.length ? `Common phrasing: ${profile.commonPhrasing.join("; ")}` : null,
      profile.doPreferences.length ? `Do: ${profile.doPreferences.join("; ")}` : null,
      profile.dontPreferences.length ? `Don't: ${profile.dontPreferences.join("; ")}` : null,
      `Summary: ${profile.summary}`,
    ]
      .filter(Boolean)
      .join("\n");
  }
}
