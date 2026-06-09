import type { Request, Response } from "express";

import { AuthBootstrapService } from "../auth/authBootstrapService.js";
import { requireUser } from "../auth/authMiddleware.js";
import { getFirebaseDb, getFirebaseAuth } from "../config/firebaseAdmin.js";
import { SmtpService } from "../services/smtpService.js";
import { logger } from "../observability/logger.js";

export function getMe(request: Request, response: Response) {
  const user = requireUser(request);

  response.json({
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName ?? null,
      photoURL: user.photoURL ?? null,
      defaultWorkspaceId: user.defaultWorkspaceId ?? null,
    },
  });
}

export async function bootstrapAuthSession(request: Request, response: Response) {
  const user = requireUser(request);
  const bootstrapService = new AuthBootstrapService(getFirebaseDb());
  const payload = await bootstrapService.bootstrap(user);

  response.json(payload);
}

export async function forgotPassword(request: Request, response: Response) {
  const { email, origin } = request.body;

  if (!email || typeof email !== "string") {
    response.status(400).json({ error: { code: "auth/invalid-email", message: "A valid email is required" } });
    return;
  }

  if (!origin || typeof origin !== "string") {
    response.status(400).json({ error: { code: "invalid_request", message: "Origin is required" } });
    return;
  }

  try {
    const auth = getFirebaseAuth();
    
    // Generate the raw Firebase action link
    const firebaseLink = await auth.generatePasswordResetLink(email);
    
    // Parse the oobCode out of it
    const url = new URL(firebaseLink);
    const oobCode = url.searchParams.get("oobCode");

    if (!oobCode) {
      throw new Error("Failed to extract oobCode from Firebase reset link");
    }

    // Construct the direct URL to our custom frontend
    const customResetLink = `${origin}/auth/action?mode=resetPassword&oobCode=${oobCode}`;

    // Send using our own SMTP service
    await SmtpService.sendPasswordResetEmail(email, customResetLink);

    response.json({ ok: true });
  } catch (error: any) {
    logger.error("Forgot password flow failed", { error, email });
    
    if (error.code === "auth/user-not-found") {
      response.status(404).json({ error: { code: "auth/user-not-found", message: "User not found" } });
      return;
    }

    response.status(500).json({ error: { code: "internal_error", message: "Failed to send reset email" } });
  }
}
