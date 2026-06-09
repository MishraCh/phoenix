import OpenAI from "openai";
import { z } from "zod";

import { OpenAIEmbeddingProvider } from "../ai/providers/openAIEmbeddingProvider.js";
import { OpenAILlmProvider } from "../ai/providers/openAILlmProvider.js";

type ProviderCheck = {
  model: string;
  listStatus: "listed" | "not_listed";
  providerStatus: "ok" | "failed";
  statusCode?: number | string;
  message?: string;
  output?: string;
};

function uniqueStrings(values: Array<string | undefined>) {
  return Array.from(new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value))));
}

function getCandidateModels() {
  const cliModels = uniqueStrings(process.argv.slice(2));

  if (cliModels.length > 0) {
    return cliModels;
  }

  return uniqueStrings([
    process.env.OPENAI_MODEL,
    process.env.OPENAI_CHAT_MODEL,
    process.env.OPENAI_FAST_MODEL,
    process.env.OPENAI_DEFAULT_MODEL,
    process.env.OPENAI_REASONING_MODEL,
    process.env.OPENAI_RESEARCH_MODEL,
  ]);
}

function printRecommendation(checks: ProviderCheck[]) {
  const usable = checks.filter((check) => check.providerStatus === "ok").map((check) => check.model);
  const unavailable = checks.filter(
    (check) =>
      check.providerStatus === "failed" &&
      (check.statusCode === 403 || /does not have access|not have access/i.test(check.message ?? "")),
  );
  const incompatible = checks.filter(
    (check) =>
      check.providerStatus === "failed" &&
      (check.statusCode === 404 || /chat\/completions|responses/i.test(check.message ?? "")),
  );

  console.log("\nSummary");
  console.log(`   Provider-compatible models: ${usable.length ? usable.join(", ") : "none"}`);

  if (unavailable.length > 0) {
    console.log(
      `   Not available to this API project: ${unavailable.map((check) => check.model).join(", ")}`,
    );
  }

  if (incompatible.length > 0) {
    console.log(
      `   Listed but incompatible with the current ChatOpenAI provider path: ${incompatible
        .map((check) => check.model)
        .join(", ")}`,
    );
  }

  const mainModel =
    ["gpt-5.5", "gpt-4.1"].find((model) => usable.includes(model)) ?? usable[0];
  const fastModel =
    ["gpt-5.4-mini", "gpt-4.1", "gpt-4.1-mini"].find((model) => usable.includes(model)) ?? usable[0];

  if (mainModel || fastModel) {
    console.log("\nRecommended compatible env values from this check:");
    if (mainModel) {
      console.log(`   OPENAI_MODEL=${mainModel}`);
      console.log(`   OPENAI_CHAT_MODEL=${mainModel}`);
      console.log(`   OPENAI_DEFAULT_MODEL=${mainModel}`);
      console.log(`   OPENAI_REASONING_MODEL=${mainModel}`);
      console.log(`   OPENAI_RESEARCH_MODEL=${mainModel}`);
    }
    if (fastModel) {
      console.log(`   OPENAI_FAST_MODEL=${fastModel}`);
    }
  }
}

async function main() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error("No OPENAI_API_KEY found in environment");
    process.exit(1);
  }

  const openai = new OpenAI({ apiKey });

  console.log("Fetching available models...");
  const modelList = await openai.models.list();
  const availableModelIds = new Set(modelList.data.map((m) => m.id));
  const visibleRelevantModelIds = modelList.data
    .map((m) => m.id)
    .filter((id) => /^(gpt-4\.1)/i.test(id))
    .sort();

  if (visibleRelevantModelIds.length > 0) {
    console.log("Visible relevant model ids:", visibleRelevantModelIds);
  }

  const candidateModels = getCandidateModels();

  console.log("Candidate chat models:", candidateModels);

  const checks: ProviderCheck[] = [];
  for (const model of candidateModels) {
    const listStatus = availableModelIds.has(model) ? "listed" : "not_listed";
    console.log(
      listStatus === "listed"
        ? `LIST_OK ${model} is returned by /v1/models`
        : `LIST_FAIL ${model} is not returned by /v1/models`,
    );
    checks.push({ model, listStatus, providerStatus: "failed" });
  }

  const schema = z.object({ response: z.string() });
  for (const model of candidateModels) {
    const check = checks.find((entry) => entry.model === model);
    try {
      const provider = new OpenAILlmProvider(model);
      const res = await provider.generateStructured({
        schema,
        systemPrompt: "You are a ping bot. Return exactly Ping in the response field.",
        userPrompt: "Ping",
      });

      console.log(`PROVIDER_OK ${model}`);
      console.log(`   output: ${res.response}`);
      if (check) {
        check.providerStatus = "ok";
        check.output = res.response;
      }
    } catch (err: any) {
      console.log(`PROVIDER_FAIL ${model}`);
      console.log(`   status: ${err.status ?? "unknown"}`);
      console.log(`   message: ${err.message ?? String(err)}`);
      if (check) {
        check.providerStatus = "failed";
        check.statusCode = err.status ?? "unknown";
        check.message = err.message ?? String(err);
      }
    }
  }

  const embeddingModel = process.env.OPENAI_EMBEDDING_MODEL;
  if (embeddingModel) {
    try {
      const embedder = new OpenAIEmbeddingProvider();
      const embedding = await embedder.embed(["hello world"]);
      console.log(`EMBED_OK ${embeddingModel}`);
      console.log(`   dimensions: ${embedding[0]?.length ?? "unknown"}`);
    } catch (err: any) {
      console.log(`EMBED_FAIL ${embeddingModel}`);
      console.log(`   status: ${err.status ?? "unknown"}`);
      console.log(`   message: ${err.message ?? String(err)}`);
    }
  }

  printRecommendation(checks);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
