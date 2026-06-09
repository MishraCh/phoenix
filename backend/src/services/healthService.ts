import { z } from "zod";

import { env } from "../config/env.js";

const healthResponseSchema = z.object({
  environment: z.enum(["development", "test", "production"]),
  service: z.literal("gideon-backend"),
  status: z.literal("ok"),
  timestamp: z.iso.datetime(),
});

export function getHealthStatus() {
  return healthResponseSchema.parse({
    environment: env.NODE_ENV,
    service: "gideon-backend",
    status: "ok",
    timestamp: new Date().toISOString(),
  });
}
