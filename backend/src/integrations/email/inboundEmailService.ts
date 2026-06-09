import { EventWebhook } from "@sendgrid/eventwebhook";
import { getFirestore } from "firebase-admin/firestore";
import { logger } from "../../observability/logger.js";
import { CommandService } from "../../command/commandService.js";
import { resolveCurrentWorkspace } from "../../services/currentWorkspaceService.js";
import { SmtpService } from "../../services/smtpService.js";
import type { AuthenticatedUser } from "../../auth/types.js";


export class InboundEmailService {
  /**
   * Verify the webhook signature to ensure it actually came from SendGrid.
   */
  static verifySignature(publicKey: string, payload: string, signature: string, timestamp: string): boolean {
    try {
      const ew = new EventWebhook();
      const ewKey = ew.convertPublicKeyToECDSA(publicKey);
      return ew.verifySignature(ewKey, payload, signature, timestamp);
    } catch (error) {
      logger.error("Failed to verify SendGrid signature", { error });
      return false;
    }
  }

  /**
   * Look up a user in Firestore based on their email address.
   */
  static async getUserByEmail(email: string): Promise<AuthenticatedUser | null> {
    const db = getFirestore();
    const snapshot = await db.collection("users").where("email", "==", email.toLowerCase().trim()).limit(1).get();
    
    if (snapshot.empty) {
      return null;
    }

    const doc = snapshot.docs[0];
    const data = doc.data();
    return {
      id: doc.id,
      email: data.email,
      defaultWorkspaceId: data.defaultWorkspaceId,
      displayName: data.displayName,
    };
  }

  /**
   * Parse the messy email text to strip out signatures and forwarded history.
   * SendGrid provides both 'text' and 'html'. We prefer 'text' for AI processing.
   */
  static parseEmailBody(text: string): { prompt: string; fullThread: string } {
    const normalized = text.replace(/\r\n/g, "\n");
    return {
      prompt: normalized.trim(),
      fullThread: normalized.trim(),
    };
  }

  /**
   * Extract a hidden session ID from the subject line to continue a conversational thread.
   */
  static extractSessionId(subject: string): string | null {
    const match = subject.match(/\[Session:([a-zA-Z0-9-]+)\]/i);
    return match ? match[1] : null;
  }

  /**
   * Process the incoming email payload from SendGrid.
   */
  static async handleIncomingEmail(payload: {
    from: string;
    to: string;
    subject: string;
    text: string;
    html?: string;
  }) {
    logger.info("Processing inbound email", { from: payload.from, subject: payload.subject });

    try {
      const emailMatch = payload.from.match(/<(.+)>/);
      const senderEmail = emailMatch ? emailMatch[1] : payload.from;

      const user = await this.getUserByEmail(senderEmail);
      if (!user) {
        logger.warn(`Inbound email from unknown user ignored: ${senderEmail}`);
        return;
      }

      const { prompt } = this.parseEmailBody(payload.text);
      if (!prompt) {
        logger.warn("Inbound email body was empty.");
        return;
      }

      const existingSessionId = this.extractSessionId(payload.subject);

      logger.info(`Routing inbound email to CommandService`, { userId: user.id, sessionId: existingSessionId ?? "new_session" });

      const currentWorkspace = await resolveCurrentWorkspace(user);

      if (currentWorkspace.workspace.plan === "free") {
        logger.warn(`Inbound email ignored: Workspace ${currentWorkspace.id} is on the free plan.`);
        return;
      }

      if (!currentWorkspace.workspace.channelsConfig?.emailEnabled) {
        logger.warn(`Inbound email ignored: Workspace ${currentWorkspace.id} has email feature disabled.`);
        return;
      }

      const commandService = new CommandService(getFirestore());

      const result = await commandService.runCommand({
        input: prompt,
        mode: "auto",
        userId: user.id,
        currentWorkspace,
        sessionId: existingSessionId || undefined,
        source: "email",
      });

      // 6. Send the reply via SMTP
      await SmtpService.sendCommandReply({
        to: senderEmail,
        originalSubject: payload.subject,
        sessionId: result.sessionId,
        result,
      });

      logger.info("Email command completed headless execution", { 
        sessionId: result.sessionId, 
        creditsCharged: result.creditsCharged 
      });

    } catch (error) {
      logger.error("Error handling inbound email", { error });
    }
  }
}
