import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

import { env } from "../config/env.js";
import { ApiError } from "../utils/apiError.js";

function getEncryptionKey() {
  if (!env.INTEGRATION_ENCRYPTION_KEY) {
    throw new ApiError({
      code: "INTEGRATION_CONFIG_MISSING",
      message: "INTEGRATION_ENCRYPTION_KEY is required for OAuth token storage.",
      status: 500,
    });
  }

  return createHash("sha256").update(env.INTEGRATION_ENCRYPTION_KEY).digest();
}

export function encryptJson(payload: unknown) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(payload), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return [iv.toString("base64url"), tag.toString("base64url"), encrypted.toString("base64url")].join(".");
}

export function decryptJson<T>(payload: string): T {
  const [ivPart, tagPart, encryptedPart] = payload.split(".");

  if (!ivPart || !tagPart || !encryptedPart) {
    throw new ApiError({
      code: "INTEGRATION_TOKEN_INVALID",
      message: "Stored integration token payload is invalid.",
      status: 500,
    });
  }

  const decipher = createDecipheriv(
    "aes-256-gcm",
    getEncryptionKey(),
    Buffer.from(ivPart, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedPart, "base64url")),
    decipher.final(),
  ]).toString("utf8");

  return JSON.parse(decrypted) as T;
}
