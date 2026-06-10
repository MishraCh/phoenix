import type { Firestore } from "firebase-admin/firestore";

import type { IntegrationProviderId } from "../../schemas/coreSchemas.js";
import { ApiError } from "../../utils/apiError.js";
import type { IntegrationProvider } from "../core/integrationContracts.js";
import { GmailProvider } from "./gmail/gmailProvider.js";
import { HubSpotProvider } from "./hubspot/hubspotProvider.js";
import { StripeProvider } from "./stripe/stripeProvider.js";

export function normalizeIntegrationProviderId(provider: string): IntegrationProviderId {
  if (provider === "google") {
    return "gmail";
  }

  if (provider === "gmail" || provider === "hubspot" || provider === "stripe") {
    return provider;
  }

  if (
    provider === "microsoft" ||
    provider === "salesforce" ||
    provider === "zoho" ||
    provider === "slack" ||
    provider === "notion" ||
    provider === "drive"
  ) {
    return provider;
  }

  throw new ApiError({
    code: "NOT_SUPPORTED",
    message: `Integration provider "${provider}" is not supported in the current Gideon cycle.`,
    status: 400,
  });
}

export function createIntegrationProvider(
  db: Firestore,
  provider: string,
): IntegrationProvider {
  const normalized = normalizeIntegrationProviderId(provider);

  if (normalized === "gmail") {
    return new GmailProvider(db);
  }

  if (normalized === "hubspot") {
    return new HubSpotProvider(db);
  }

  if (normalized === "stripe") {
    return new StripeProvider(db);
  }

  throw new ApiError({
    code: "NOT_SUPPORTED",
    message: `Provider "${normalized}" is planned but not implemented yet.`,
    status: 400,
  });
}
