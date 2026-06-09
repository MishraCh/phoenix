import { env } from "../config/env.js";
import { createLlmProvider, LlmRole } from "../ai/providers/providerRegistry.js";
import { z } from "zod";

async function runSmokeTests() {
  console.log("=== Role Resolution & Smoke Tests ===\n");
  
  const roles: LlmRole[] = ['fast', 'default', 'reasoning', 'research'];
  const testSchema = z.object({ response: z.string() });
  
  for (const role of roles) {
    console.log(`Checking role: ${role}`);
    try {
      const provider = createLlmProvider(role);
      const modelName = (provider as any).modelName || env[`OPENAI_${role.toUpperCase()}_MODEL` as keyof typeof env] || "unknown";
      console.log(`- Resolved Model: ${modelName}`);
      
      const result = await provider.generateStructured({
        systemPrompt: "You are a ping bot. Always respond with exactly the word Ping in the response field.",
        userPrompt: "Ping",
        schema: testSchema
      });
      
      if (result && result.response) {
        console.log(`- Smoke Test: ✅ Passed (Response: ${result.response})`);
      } else {
        console.log(`- Smoke Test: ❌ Failed (Empty response)`);
      }
    } catch (error: any) {
      console.log(`- Smoke Test: ❌ Failed (${error.message})`);
    }
    console.log("");
  }
}

runSmokeTests();
