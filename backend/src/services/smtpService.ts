import nodemailer from "nodemailer";
import { logger } from "../observability/logger.js";
import { buildExpertPlanAnswer } from "../ai/graphs/commandGraph.js";
import { sanitizeAiOutput } from "../utils/aiOutputSanitizer.js";

export class SmtpService {
  private static transporter = nodemailer.createTransport({
    // Using the Twilio/SendGrid SMTP configuration provided by the team
    host: process.env.SMTP_HOST || "smtp.sendgrid.net",
    port: Number(process.env.SMTP_PORT) || 465,
    secure: true, // true for 465, false for other ports
    auth: {
      user: process.env.SMTP_USER || "apikey",
      pass: process.env.SMTP_PASS || "",
    },
  });

  /**
   * Convert the AI's CommandResponse payload into a human-readable HTML email.
   * If it's a simple text answer, returns it wrapped in a paragraph.
   * If it's an expert execution (like a scorecard), renders a basic table.
   */
  private static renderCommandResultToHtml(result: any): string {
    let html = `<div style="font-family: Arial, sans-serif; color: #333; line-height: 1.6;">`;

    // 1. Text Answer (if any)
    if (result.answer) {
      html += `<p>${result.answer.replace(/\n/g, "<br>")}</p>`;
    }

    // 2. Expert Payload (if it used an expert agent)
    if (result.expertExecution && result.expertExecution.payload) {
      const summary = buildExpertPlanAnswer(result.expertExecution);
      if (summary && summary !== result.answer) {
        html += `<p><strong>${summary}</strong></p>`;
      }

      html += `<table style="width: 100%; border-collapse: collapse; margin-top: 15px;">`;
      for (const [key, value] of Object.entries(result.expertExecution.payload)) {
        if (typeof value === "string" || typeof value === "number") {
          html += `
            <tr style="border-bottom: 1px solid #ddd;">
              <td style="padding: 8px; font-weight: bold; text-transform: capitalize; width: 30%;">${key.replace(/([A-Z])/g, ' $1')}</td>
              <td style="padding: 8px;">${value}</td>
            </tr>`;
        }
      }
      html += `</table>`;
    }

    // 3. Artifact/Approval Link
    html += `
      <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
      <p style="font-size: 12px; color: #888;">
        Sent by Gideon. <a href="https://gideon-ai-ae305.web.app/" style="color: #6366f1;">Open Workspace</a> to view full details.
      </p>
    </div>`;

    return html;
  }

  /**
   * Send an email reply back to the user after Gideon completes a task.
   */
  static async sendCommandReply(params: {
    to: string;
    originalSubject: string;
    sessionId: string;
    result: any;
  }) {
    try {
      const htmlBody = this.renderCommandResultToHtml(params.result);

      // Embed the Session ID invisibly in the subject or body to thread future replies
      const subject = params.originalSubject.startsWith("Re:")
        ? params.originalSubject
        : `Re: ${params.originalSubject}`;

      const threadedSubject = subject.includes("[Session:")
        ? subject
        : `${subject} [Session:${params.sessionId}]`;

      const info = await this.transporter.sendMail({
        from: `"Gideon AI" <${process.env.GIDEON_EMAIL || "support@xfactorai.com"}>`,
        to: params.to,
        subject: threadedSubject,
        html: htmlBody,
      });

      logger.info("Sent email reply to user", {
        to: params.to,
        messageId: info.messageId
      });
      return true;

    } catch (error) {
      logger.error("Failed to send email reply", { error });
      return false;
    }
  }

  /**
   * Send a custom password reset email
   */
  static async sendPasswordResetEmail(email: string, resetLink: string) {
    try {
      const htmlBody = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Reset your Gideon password</title>
        </head>
        <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #F8F9FF; color: #0B1C30;">
          <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #F8F9FF; padding: 40px 20px;">
            <tr>
              <td align="center">
                <table width="100%" max-width="520" border="0" cellspacing="0" cellpadding="0" style="max-width: 520px; background-color: #ffffff; border-radius: 16px; border: 1px solid #E6E4F7; box-shadow: 0 10px 25px -10px rgba(53, 37, 205, 0.1); overflow: hidden;">
                  
                  <!-- Header -->
                  <tr>
                    <td style="padding: 32px 40px 0px 40px;">
                      <div style="font-size: 24px; font-weight: 700; color: #0B1C30; letter-spacing: -0.5px;">
                        <span style="color: #3525CD;">Gideon</span> Workspace
                      </div>
                    </td>
                  </tr>

                  <!-- Content -->
                  <tr>
                    <td style="padding: 24px 40px 32px 40px;">
                      <h2 style="margin: 0 0 16px 0; font-size: 20px; font-weight: 600; color: #0B1C30;">Reset your password</h2>
                      <p style="margin: 0 0 24px 0; font-size: 15px; line-height: 1.6; color: #5F6072;">
                        Hi there,<br><br>
                        We received a request to reset the password for your Gideon workspace account associated with <strong>${email}</strong>.
                      </p>
                      
                      <!-- Button -->
                      <table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin: 32px 0;">
                        <tr>
                          <td align="center">
                            <a href="${resetLink}" style="display: inline-block; background: linear-gradient(90deg, #3525CD 0%, #4835E9 100%); background-color: #3525CD; color: #ffffff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 15px; font-weight: 600; text-decoration: none; padding: 14px 32px; border-radius: 12px; box-shadow: 0 8px 16px -8px rgba(53, 37, 205, 0.4);">
                              Reset Password
                            </a>
                          </td>
                        </tr>
                      </table>

                      <p style="margin: 0; font-size: 14px; line-height: 1.6; color: #7A7791;">
                        If you didn't request a password reset, you can safely ignore this email. Your password will remain securely unchanged.
                      </p>
                    </td>
                  </tr>

                  <!-- Divider -->
                  <tr>
                    <td style="padding: 0 40px;">
                      <div style="height: 1px; background-color: #F1F0F9;"></div>
                    </td>
                  </tr>

                  <!-- Footer -->
                  <tr>
                    <td style="padding: 24px 40px 32px 40px; text-align: center;">
                      <p style="margin: 0; font-size: 13px; color: #8F8C9A;">
                        &copy; ${new Date().getFullYear()} Gideon AI. All rights reserved.<br>
                        Empowering your team with data-driven clarity.
                      </p>
                    </td>
                  </tr>

                </table>
              </td>
            </tr>
          </table>
        </body>
        </html>
      `;

      const info = await this.transporter.sendMail({
        from: `"Gideon Security" <${process.env.GIDEON_NOREPLY_EMAIL || "noreply@xfactorai.com"}>`,
        to: email,
        subject: "Reset your Gideon password",
        html: htmlBody,
      });

      logger.info("Sent password reset email", { to: email, messageId: info.messageId });
      return true;
    } catch (error) {
      logger.error("Failed to send password reset email", { error });
      throw new Error("Failed to send reset email via SMTP");
    }
  }

  /**
   * Send a workflow action required email
   */
  static async sendWorkflowActionRequired(email: string, title: string, body: string, actionUrl: string) {
    try {
      const htmlBody = `
        <div style="font-family: Arial, sans-serif; color: #333; line-height: 1.6;">
          <h2>Workflow Action Required</h2>
          <p><strong>${title}</strong></p>
          <p>${body}</p>
          <a href="https://gideon-ai-ae305.web.app${actionUrl}" style="display: inline-block; padding: 10px 20px; background-color: #3525CD; color: #fff; text-decoration: none; border-radius: 5px;">Review Action</a>
        </div>
      `;

      const info = await this.transporter.sendMail({
        from: `"Gideon AI" <${process.env.GIDEON_EMAIL || "support@xfactorai.com"}>`,
        to: email,
        subject: `Action Required: ${title}`,
        html: htmlBody,
      });

      logger.info("Sent workflow action required email", { to: email, messageId: info.messageId });
      return true;
    } catch (error) {
      logger.error("Failed to send workflow action email", { error });
      return false;
    }
  }

  /**
   * Send a generic workflow notification email with full content rendering.
   * Supports multi-paragraph AI output — no truncation on the body.
   */
  static async sendWorkflowNotificationEmail(email: string, title: string, rawBody: string, actionUrl: string) {
    try {
      const body = typeof rawBody === "string" ? sanitizeAiOutput(rawBody) : rawBody;
      // Basic markdown to HTML converter for email payloads
      const renderBody = (text: string): string => {
        if (!text) return "<p style=\"color:#5F6072;\">No additional details were provided.</p>";

        let processed = text
          .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
          .replace(/(?<!\*)\*(?!\*)(.*?)(?<!\*)\*(?!\*)/g, '<strong>$1</strong>')
          .replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" style="color:#3525CD; text-decoration: none;">$1</a>')
          .replace(/^### (.*$)/gim, '<h4 style="margin-top: 24px; margin-bottom: 12px; color:#0B1C30; font-size: 16px;">$1</h4>')
          .replace(/^## (.*$)/gim, '<h3 style="margin-top: 28px; margin-bottom: 14px; color:#0B1C30; font-size: 18px;">$1</h3>')
          .replace(/^# (.*$)/gim, '<h2 style="margin-top: 32px; margin-bottom: 16px; color:#0B1C30; font-size: 22px;">$1</h2>');

        const blocks = processed.split(/\n{2,}/);

        return blocks.map((block) => {
          const trimmed = block.trim();
          if (!trimmed) return "";

          // If the block contains list items (lines starting with - or *)
          if (trimmed.split('\n').some(line => line.trim().match(/^[-*]\s+/))) {
            const lines = trimmed.split('\n');
            let out = '';
            let inList = false;

            for (const line of lines) {
              const lTrim = line.trim();
              if (lTrim.match(/^[-*]\s+/)) {
                if (!inList) {
                  out += `<ul style="margin: 0 0 16px 0; padding-left: 24px; font-size: 15px; line-height: 1.7; color: #3D3D4E;">`;
                  inList = true;
                }
                out += `<li style="margin-bottom: 8px;">${lTrim.replace(/^[-*]\s+/, '')}</li>`;
              } else {
                if (inList) {
                  out += `</ul>`;
                  inList = false;
                }
                // If it's a heading, leave it raw, otherwise it's a para line
                if (lTrim.startsWith('<h')) {
                  out += lTrim;
                } else if (lTrim) {
                  out += `<p style="margin: 0 0 16px 0; font-size: 15px; line-height: 1.7; color: #3D3D4E;">${lTrim}</p>`;
                }
              }
            }
            if (inList) out += `</ul>`;
            return out;
          } else if (trimmed.startsWith('<h')) {
            return trimmed;
          } else {
            const paraContent = trimmed.replace(/\n/g, "<br>");
            return `<p style="margin: 0 0 16px 0; font-size: 15px; line-height: 1.7; color: #3D3D4E;">${paraContent}</p>`;
          }
        }).join("");
      };

      const appUrl = `https://gideon-ai-ae305.web.app${actionUrl}`;
      const year = new Date().getFullYear();

      const htmlBody = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background-color:#F8F9FF;color:#0B1C30;">
  <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color:#F8F9FF;padding:40px 20px;">
    <tr>
      <td align="center">
        <!-- Expanded max-width for bigger text payloads -->
        <table width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width:760px;background-color:#ffffff;border-radius:16px;border:1px solid #E6E4F7;box-shadow:0 10px 25px -10px rgba(53,37,205,0.1);overflow:hidden;">

          <!-- Header -->
          <tr>
            <td style="padding:28px 40px 0 40px;">
              <div style="font-size:22px;font-weight:700;color:#0B1C30;letter-spacing:-0.5px;">
                <span style="color:#3525CD;">Gideon</span> Workspace
              </div>
            </td>
          </tr>

          <!-- Badge -->
          <tr>
            <td style="padding:20px 40px 0 40px;">
              <span style="display:inline-block;background-color:#EEF0FF;color:#3525CD;font-size:12px;font-weight:600;padding:4px 12px;border-radius:20px;letter-spacing:0.3px;">WORKFLOW ALERT</span>
            </td>
          </tr>

          <!-- Title -->
          <tr>
            <td style="padding:16px 40px 0 40px;">
              <h2 style="margin:0;font-size:20px;font-weight:700;color:#0B1C30;line-height:1.3;">${title}</h2>
            </td>
          </tr>

          <!-- Divider -->
          <tr>
            <td style="padding:20px 40px 0 40px;">
              <div style="height:1px;background:linear-gradient(90deg,#3525CD22,#3525CD08);"></div>
            </td>
          </tr>

          <!-- Body Content -->
          <tr>
            <td style="padding:24px 40px 8px 40px;">
              ${renderBody(body)}
            </td>
          </tr>

          <!-- CTA Button -->
          <tr>
            <td style="padding:16px 40px 32px 40px;">
              <a href="${appUrl}" style="display:inline-block;background:linear-gradient(90deg,#3525CD 0%,#4835E9 100%);background-color:#3525CD;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;padding:12px 28px;border-radius:10px;box-shadow:0 8px 16px -8px rgba(53,37,205,0.4);">
                View in Workspace →
              </a>
            </td>
          </tr>

          <!-- Divider -->
          <tr>
            <td style="padding:0 40px;">
              <div style="height:1px;background-color:#F1F0F9;"></div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:20px 40px 28px 40px;text-align:center;">
              <p style="margin:0;font-size:12px;color:#8F8C9A;">
                Sent by Gideon AI · <a href="${appUrl}" style="color:#3525CD;text-decoration:none;">Open Workspace</a><br>
                &copy; ${year} Gideon AI. All rights reserved.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

      const info = await this.transporter.sendMail({
        from: `"Gideon AI" <${process.env.GIDEON_NOREPLY_EMAIL || "noreply@xfactorai.com"}>`,
        to: email,
        subject: `Workflow Update: ${title}`,
        html: htmlBody,
      });

      logger.info("Sent workflow notification email", { to: email, messageId: info.messageId });
      return true;
    } catch (error) {
      logger.error("Failed to send workflow notification email", { error });
      return false;
    }
  }

  /**
   * Send a commitment reminder email
   */
  static async sendCommitmentReminder(email: string, title: string, body: string, actionUrl: string) {
    try {
      const htmlBody = `
        <div style="font-family: Arial, sans-serif; color: #333; line-height: 1.6;">
          <h2>Commitment Reminder</h2>
          <p><strong>${title}</strong></p>
          <p>${body}</p>
          <a href="https://gideon-ai-ae305.web.app${actionUrl}" style="display: inline-block; padding: 10px 20px; background-color: #3525CD; color: #fff; text-decoration: none; border-radius: 5px;">View Details</a>
        </div>
      `;

      const info = await this.transporter.sendMail({
        from: `"Gideon AI" <${process.env.GIDEON_EMAIL || "support@xfactorai.com"}>`,
        to: email,
        subject: `Reminder: ${title}`,
        html: htmlBody,
      });

      logger.info("Sent commitment reminder email", { to: email, messageId: info.messageId });
      return true;
    } catch (error) {
      logger.error("Failed to send commitment reminder email", { error });
      return false;
    }
  }

  /**
   * Send a daily brief email
   */
  static async sendDailyBrief(email: string, title: string, body: string, actionUrl: string) {
    try {
      const htmlBody = `
        <div style="font-family: Arial, sans-serif; color: #333; line-height: 1.6;">
          <div style="background-color: #0B1C30; padding: 15px; border-radius: 8px 8px 0 0;">
            <h2 style="color: #ffffff; margin: 0;">Gideon Daily Brief</h2>
          </div>
          <div style="border: 1px solid #ddd; border-top: none; padding: 20px; border-radius: 0 0 8px 8px;">
            <p><strong>${title}</strong></p>
            <p>${body.replace(/\n/g, "<br>")}</p>
            <a href="https://gideon-ai-ae305.web.app${actionUrl}" style="display: inline-block; padding: 10px 20px; background-color: #0B1C30; color: #fff; text-decoration: none; border-radius: 5px; margin-top: 15px;">Open Workspace</a>
          </div>
        </div>
      `;

      const info = await this.transporter.sendMail({
        from: `"Gideon AI" <${process.env.GIDEON_EMAIL || "support@xfactorai.com"}>`,
        to: email,
        subject: `Your Daily Brief: ${title}`,
        html: htmlBody,
      });

      logger.info("Sent daily brief email", { to: email, messageId: info.messageId });
      return true;
    } catch (error) {
      logger.error("Failed to send daily brief email", { error });
      return false;
    }
  }
}
