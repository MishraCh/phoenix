import { createHmac } from "node:crypto";

import { google } from "googleapis";

import { env } from "../config/env.js";
import { ApiError } from "../utils/apiError.js";

const googleScopes = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/calendar.readonly",
];

type OAuthStatePayload = {
  workspaceId: string;
  userId: string;
  provider: "google";
  createdAt: number;
};

function getStateSecret() {
  if (!env.INTEGRATION_STATE_SECRET) {
    throw new ApiError({
      code: "INTEGRATION_CONFIG_MISSING",
      message: "INTEGRATION_STATE_SECRET is required for OAuth state validation.",
      status: 500,
    });
  }

  return env.INTEGRATION_STATE_SECRET;
}

function getOAuthClient() {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_REDIRECT_URI) {
    throw new ApiError({
      code: "INTEGRATION_CONFIG_MISSING",
      message:
        "Google OAuth is not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI.",
      status: 500,
    });
  }

  return new google.auth.OAuth2(
    env.GOOGLE_CLIENT_ID,
    env.GOOGLE_CLIENT_SECRET,
    env.GOOGLE_REDIRECT_URI,
  );
}

function signState(serialized: string) {
  return createHmac("sha256", getStateSecret()).update(serialized).digest("base64url");
}

export function createGoogleOAuthState(payload: OAuthStatePayload) {
  const serialized = JSON.stringify(payload);
  const encoded = Buffer.from(serialized, "utf8").toString("base64url");
  return `${encoded}.${signState(serialized)}`;
}

export function parseGoogleOAuthState(state: string): OAuthStatePayload {
  const [encoded, signature] = state.split(".");

  if (!encoded || !signature) {
    throw new ApiError({
      code: "INTEGRATION_STATE_INVALID",
      message: "Google OAuth state is invalid.",
      status: 400,
    });
  }

  const serialized = Buffer.from(encoded, "base64url").toString("utf8");

  if (signState(serialized) !== signature) {
    throw new ApiError({
      code: "INTEGRATION_STATE_INVALID",
      message: "Google OAuth state signature did not match.",
      status: 400,
    });
  }

  const parsed = JSON.parse(serialized) as OAuthStatePayload;

  if (parsed.provider !== "google") {
    throw new ApiError({
      code: "INTEGRATION_STATE_INVALID",
      message: "Google OAuth state is invalid.",
      status: 400,
    });
  }

  return parsed;
}

export function createGoogleAuthUrl(state: string) {
  return getOAuthClient().generateAuthUrl({
    access_type: "offline",
    include_granted_scopes: true,
    prompt: "consent",
    scope: googleScopes,
    state,
  });
}

export async function exchangeGoogleCode(code: string) {
  const oauthClient = getOAuthClient();
  const { tokens } = await oauthClient.getToken(code);
  return tokens;
}

export function getGoogleWorkspaceCapabilities() {
  return ["email.read", "email.draft", "calendar.read"];
}

export function getGoogleWorkspaceScopes() {
  return [...googleScopes];
}
