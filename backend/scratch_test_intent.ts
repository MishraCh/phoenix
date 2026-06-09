import { SemanticIntentClassifier } from "./src/ai/routing/semanticIntentClassifier.js";

async function run() {
  const classifier = new SemanticIntentClassifier();
  const result = await classifier.classify({
    userQuery: "Can you give me a summary of what XFactor AI does based on my workspace profile?",
    selectedItem: null,
    availableCapabilities: ["hubspot_read", "hubspot_write", "gmail_read"],
    retrievedExpertSopMetadata: []
  });
  console.log("Intent Result:", result);
}

run().catch(console.error);
