import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

function loadBackendEnvFile() {
  const currentFilePath = fileURLToPath(import.meta.url);
  const backendRoot = resolve(dirname(currentFilePath), "..", "..");
  const envFilePath = resolve(backendRoot, ".env");

  if (!existsSync(envFilePath)) {
    return;
  }

  const rawEnvFile = readFileSync(envFilePath, "utf8");

  for (const line of rawEnvFile.split(/\r?\n/)) {
    const trimmedLine = line.trim();

    if (!trimmedLine || trimmedLine.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmedLine.indexOf("=");

    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmedLine.slice(0, separatorIndex).trim();
    let value = trimmedLine.slice(separatorIndex + 1).trim();

    if (!key) {
      continue;
    }

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}

loadBackendEnvFile();

function optionalString() {
  return z.preprocess((value) => {
    if (typeof value !== "string") {
      return value;
    }

    const trimmedValue = value.trim();
    return trimmedValue === "" ? undefined : trimmedValue;
  }, z.string().min(1).optional());
}

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_PORT: z.coerce.number().int().positive().default(3001),
  API_BASE_URL: z.string().url().optional(),
  FRONTEND_ORIGIN: z.string().optional(),
  GIDEON_FIREBASE_PROJECT_ID: optionalString(),
  GIDEON_FIREBASE_CLIENT_EMAIL: z.preprocess((value) => {
    if (typeof value !== "string") {
      return value;
    }

    const trimmedValue = value.trim();
    return trimmedValue === "" ? undefined : trimmedValue;
  }, z.string().email().optional()),
  GIDEON_FIREBASE_PRIVATE_KEY: optionalString(),
  LOG_LEVEL: z
    .enum(["error", "warn", "info", "http", "verbose", "debug", "silly"])
    .default("info"),
  WORKER_TRIGGER_SECRET: optionalString(),
  // --- Model routing (AI Gateway) ---
  // LLM_PROVIDER: "auto" => Gateway iff AI_GATEWAY_API_KEY present, else OpenAI fallback.
  LLM_PROVIDER: z.enum(["auto", "gateway", "openai"]).default("auto"),
  AI_GATEWAY_API_KEY: optionalString(),
  EXA_API_KEY: optionalString(),
  // Exa Websets requires a Pro plan. When false (default), lead datasets build via the
  // search+enrich fallback (works on any plan). Set true once Pro access exists.
  EXA_WEBSETS_ENABLED: z.string().default("false"),
  // --- Stripe (payment gateway + integration) ---
  STRIPE_SECRET_KEY: optionalString(),
  STRIPE_WEBHOOK_SECRET: optionalString(),
  STRIPE_PRICE_PLUS: optionalString(),
  STRIPE_PRICE_PRO: optionalString(),
  GATEWAY_FAST_MODEL: z.string().default("openai/gpt-5.4-mini"),
  GATEWAY_DEFAULT_MODEL: z.string().default("anthropic/claude-sonnet-4.5"),
  GATEWAY_REASONING_MODEL: z.string().default("anthropic/claude-sonnet-4.5"),
  GATEWAY_RESEARCH_MODEL: z.string().default("anthropic/claude-sonnet-4.5"),
  // EMBEDDING_PROVIDER: "auto" => Gateway iff AI_GATEWAY_API_KEY present, else OpenAI direct.
  EMBEDDING_PROVIDER: z.enum(["auto", "gateway", "openai"]).default("auto"),
  GATEWAY_EMBEDDING_MODEL: z.string().default("openai/text-embedding-3-small"),
  OPENAI_API_KEY: optionalString(),
  OPENAI_CHAT_MODEL: z.string().default("gpt-5.5"), // Keep for legacy fallbacks
  OPENAI_MODEL: z.string().default("gpt-5.5"),
  OPENAI_FAST_MODEL: z.string().default("gpt-5.4-mini"),
  OPENAI_DEFAULT_MODEL: z.string().default("gpt-5.5"),
  OPENAI_REASONING_MODEL: z.string().default("gpt-5.5"),
  OPENAI_RESEARCH_MODEL: z.string().default("gpt-5.5"),
  OPENAI_EMBEDDING_MODEL: z.string().default("text-embedding-3-small"),
  OPENAI_EMBEDDING_DIMENSIONS: z.coerce.number().int().positive().optional(),
  // Web Intelligence 
  WEB_RESEARCH_PROVIDER: z.string().default("openai_graph"),
  WEB_SEARCH_PROVIDER: z.string().default("openai_web_search"),
  WEB_EXTRACT_PROVIDER: z.string().default("reasoning_extract"),
  WEB_EXTRACT_FALLBACK: z.enum(["internal", "playwright", "none"]).default("none"),
  GOOGLE_CLIENT_ID: optionalString(),
  GOOGLE_CLIENT_SECRET: optionalString(),
  GOOGLE_REDIRECT_URI: z.string().url().optional(),
  GOOGLE_POST_AUTH_REDIRECT: z.string().url().optional(),
  GMAIL_POST_AUTH_REDIRECT: z.string().url().optional(),
  GMAIL_PUBSUB_TOPIC_NAME: optionalString(),
  GMAIL_PUBSUB_AUDIENCE: optionalString(),
  GMAIL_PUBSUB_SERVICE_ACCOUNT_EMAIL: optionalString(),
  HUBSPOT_CLIENT_ID: optionalString(),
  HUBSPOT_CLIENT_SECRET: optionalString(),
  HUBSPOT_REDIRECT_URI: z.string().url().optional(),
  HUBSPOT_POST_AUTH_REDIRECT: z.string().url().optional(),
  INTEGRATION_STATE_SECRET: optionalString(),
  INTEGRATION_ENCRYPTION_KEY: optionalString(),
  WORKER_POLLING_ENABLED: z.string().default("false"), // Deprecated, but keep schema valid if passed
  LOCAL_WORKER_POLLING: z.string().default("false"),
  SCHEDULER_ENABLED: z.string().default("false"), // Deprecated
  SCHEDULER_TICK_INTERVAL_MS: z.coerce.number().int().positive().default(300_000), // Deprecated
  INTERNAL_API_KEY: optionalString(),
  GOOGLE_CLOUD_TASKS_QUEUE_PATH: optionalString(),
  WORKER_WEBHOOK_URL: optionalString(),
  GIDEON_NOREPLY_EMAIL: optionalString(),
  AI_V2_KILL_SWITCH: z.string().default("false"),
  AI_TRACE_V2: z.string().default("true"),
  SESSION_STATE_V2: z.string().default("true"),
  ROUTE_V2_SHADOW: z.string().default("true"),
  ROUTE_V2_ACTIVE: z.string().default("true"),
  CONTEXT_V2: z.string().default("false"),
  EXECUTION_V2: z.string().default("false"),
  AGENTIC_TOOLLOOP_V1: z.string().default("false"),
  RETRIEVAL_V2_SHADOW: z.string().default("false"),
  RETRIEVAL_V2_ACTIVE: z.string().default("false"),
  EXPERT_V2: z.string().default("false"),
  RESEARCH_V2: z.string().default("false"),
  WORKFLOW_V2: z.string().default("false"),
  AI_TRACE_V2_PERCENT: z.coerce.number().min(0).max(100).default(0),
  SESSION_STATE_V2_PERCENT: z.coerce.number().min(0).max(100).default(0),
  ROUTE_V2_SHADOW_PERCENT: z.coerce.number().min(0).max(100).default(0),
  ROUTE_V2_ACTIVE_PERCENT: z.coerce.number().min(0).max(100).default(0),
  CONTEXT_V2_PERCENT: z.coerce.number().min(0).max(100).default(0),
  EXECUTION_V2_PERCENT: z.coerce.number().min(0).max(100).default(0),
  RETRIEVAL_V2_SHADOW_PERCENT: z.coerce.number().min(0).max(100).default(0),
  RETRIEVAL_V2_ACTIVE_PERCENT: z.coerce.number().min(0).max(100).default(0),
  EXPERT_V2_PERCENT: z.coerce.number().min(0).max(100).default(0),
  RESEARCH_V2_PERCENT: z.coerce.number().min(0).max(100).default(0),
  WORKFLOW_V2_PERCENT: z.coerce.number().min(0).max(100).default(0),
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  const issueSummary = parsedEnv.error.issues
    .map((issue) => `${issue.path.join(".") || "env"}: ${issue.message}`)
    .join("; ");

  throw new Error(`Invalid backend environment configuration: ${issueSummary}`);
}

export const env = {
  ...parsedEnv.data,
  PORT: parsedEnv.data.API_PORT,
  FIREBASE_PROJECT_ID: parsedEnv.data.GIDEON_FIREBASE_PROJECT_ID,
  FIREBASE_CLIENT_EMAIL: parsedEnv.data.GIDEON_FIREBASE_CLIENT_EMAIL,
  FIREBASE_PRIVATE_KEY: parsedEnv.data.GIDEON_FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
  WORKER_POLLING_ENABLED: parsedEnv.data.WORKER_POLLING_ENABLED === "true",
  LOCAL_WORKER_POLLING: parsedEnv.data.LOCAL_WORKER_POLLING === "true",
  SCHEDULER_ENABLED: parsedEnv.data.SCHEDULER_ENABLED === "true",
  AI_V2_KILL_SWITCH: parsedEnv.data.AI_V2_KILL_SWITCH === "true",
  AI_TRACE_V2: parsedEnv.data.AI_TRACE_V2 === "true",
  SESSION_STATE_V2: parsedEnv.data.SESSION_STATE_V2 === "true",
  ROUTE_V2_SHADOW: parsedEnv.data.ROUTE_V2_SHADOW === "true",
  ROUTE_V2_ACTIVE: parsedEnv.data.ROUTE_V2_ACTIVE === "true",
  CONTEXT_V2: parsedEnv.data.CONTEXT_V2 === "true",
  EXECUTION_V2: parsedEnv.data.EXECUTION_V2 === "true",
  AGENTIC_TOOLLOOP_V1: parsedEnv.data.AGENTIC_TOOLLOOP_V1 === "true",
  EXA_WEBSETS_ENABLED: parsedEnv.data.EXA_WEBSETS_ENABLED === "true",
  RETRIEVAL_V2_SHADOW: parsedEnv.data.RETRIEVAL_V2_SHADOW === "true",
  RETRIEVAL_V2_ACTIVE: parsedEnv.data.RETRIEVAL_V2_ACTIVE === "true",
  EXPERT_V2: parsedEnv.data.EXPERT_V2 === "true",
  RESEARCH_V2: parsedEnv.data.RESEARCH_V2 === "true",
  WORKFLOW_V2: parsedEnv.data.WORKFLOW_V2 === "true",
};
