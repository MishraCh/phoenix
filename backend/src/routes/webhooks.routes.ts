import { Router, type Request, type Response } from "express";
import multer from "multer";
import { InboundEmailService } from "../integrations/email/inboundEmailService.js";
import { logger } from "../observability/logger.js";

export const webhooksRouter = Router();

// SendGrid Inbound Parse sends data as multipart/form-data.
// We use multer to parse the text fields. (Attachments are ignored for now in Phase 1).
const upload = multer();

/**
 * POST /api/webhooks/sendgrid-inbound
 * 
 * Receives incoming emails from SendGrid Inbound Parse.
 */
webhooksRouter.post("/sendgrid-inbound", upload.none(), (req: Request, res: Response) => {
  // 1. Immediately acknowledge the webhook to prevent SendGrid from timing out and retrying.
  res.status(200).send("OK");

  try {
    // 2. Extract payload
    // SendGrid payload fields: https://docs.sendgrid.com/for-developers/parsing-email/setting-up-the-inbound-parse-webhook
    const payload = {
      from: req.body.from as string,
      to: req.body.to as string,
      subject: req.body.subject as string,
      text: req.body.text as string,
      html: req.body.html as string,
    };

    if (!payload.from || !payload.text) {
      logger.warn("Received malformed SendGrid payload", { body: req.body });
      return;
    }

    // 3. Security Check (Optional but highly recommended)
    // To enable this in production, you would configure the SendGrid Event Webhook Signature
    // and pass the headers: X-Twilio-Email-Event-Webhook-Signature and X-Twilio-Email-Event-Webhook-Timestamp.
    // For now, we trust the route, but rely on Firestore email matching for authorization.

    // 4. Process Asynchronously
    // We do NOT await this because we already returned 200 OK.
    InboundEmailService.handleIncomingEmail(payload).catch((error) => {
      logger.error("Unhandled error in InboundEmailService.handleIncomingEmail", { error });
    });

  } catch (error) {
    logger.error("Error parsing SendGrid webhook", { error });
  }
});
