import { Router } from "express";
import { z } from "zod";

import { authMiddleware } from "../auth/authMiddleware.js";
import {
  analyzeGmailStyleProfile,
  connectIntegration,
  deleteGmailStyleProfile,
  disconnectIntegration,
  getGmailStyleProfile,
  getIntegrationDetail,
  getIntegrationItemDetail,
  getIntegrationWorkspace,
  gmailPubSubWebhook,
  hubspotWebhook,
  integrationCallback,
  listIntegrations,
  renewGmailWatches,
  runIntegrationAction,
  syncIntegration,
} from "../controllers/integrationController.js";
import { validateRequest } from "../utils/validateRequest.js";

const providerParamsSchema = z.object({
  provider: z.enum(["gmail", "google", "microsoft", "hubspot", "salesforce", "zoho", "slack", "notion", "drive"]),
});
const providerItemParamsSchema = providerParamsSchema.extend({
  itemId: z.string().min(1),
});
const providerActionParamsSchema = providerParamsSchema.extend({
  action: z.string().min(1),
});

export const integrationsRouter = Router();

integrationsRouter.post("/webhooks/gmail/pubsub", gmailPubSubWebhook);
integrationsRouter.post("/webhooks/hubspot/events", hubspotWebhook);
integrationsRouter.post("/internal/gmail/renew-watches", renewGmailWatches);
integrationsRouter.get("/integrations", authMiddleware, listIntegrations);
integrationsRouter.get(
  "/integrations/:provider",
  authMiddleware,
  validateRequest({ params: providerParamsSchema }),
  getIntegrationDetail,
);
integrationsRouter.get(
  "/integrations/:provider/workspace",
  authMiddleware,
  validateRequest({ params: providerParamsSchema }),
  getIntegrationWorkspace,
);
integrationsRouter.get(
  "/integrations/:provider/items/:itemId",
  authMiddleware,
  validateRequest({ params: providerItemParamsSchema }),
  getIntegrationItemDetail,
);
integrationsRouter.post(
  "/integrations/:provider/connect",
  authMiddleware,
  validateRequest({ params: providerParamsSchema }),
  connectIntegration,
);
integrationsRouter.get(
  "/integrations/:provider/callback",
  validateRequest({ params: providerParamsSchema }),
  integrationCallback,
);
integrationsRouter.post(
  "/integrations/:provider/disconnect",
  authMiddleware,
  validateRequest({ params: providerParamsSchema }),
  disconnectIntegration,
);
integrationsRouter.post(
  "/integrations/:provider/sync",
  authMiddleware,
  validateRequest({ params: providerParamsSchema }),
  syncIntegration,
);
integrationsRouter.post(
  "/integrations/:provider/actions/:action",
  authMiddleware,
  validateRequest({ params: providerActionParamsSchema }),
  runIntegrationAction,
);
integrationsRouter.get(
  "/integrations/gmail/style-profile",
  authMiddleware,
  getGmailStyleProfile,
);
integrationsRouter.post(
  "/integrations/gmail/style-profile/analyze",
  authMiddleware,
  analyzeGmailStyleProfile,
);
integrationsRouter.delete(
  "/integrations/gmail/style-profile",
  authMiddleware,
  deleteGmailStyleProfile,
);
