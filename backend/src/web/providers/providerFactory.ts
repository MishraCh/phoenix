import { env } from "../../config/env.js";
import { OpenAIWebSearchProvider } from "./openAIWebSearchProvider.js";
import { DuckDuckGoSearchProvider } from "./duckduckgoSearchProvider.js";
import { CheerioHtmlExtractProvider } from "./cheerioHtmlExtractProvider.js";
import { ExaSearchProvider } from "./exaSearchProvider.js";
import { ExaContentsProvider } from "./exaContentsProvider.js";

export type SearchProvider = ExaSearchProvider | OpenAIWebSearchProvider | DuckDuckGoSearchProvider;
export type ExtractProvider = ExaContentsProvider | CheerioHtmlExtractProvider;

/** Provider IDs that return a synthesized, citation-backed answer directly. */
export function isDirectAnswerSearchProvider(): boolean {
  return env.WEB_SEARCH_PROVIDER === "exa" || env.WEB_SEARCH_PROVIDER === "openai_web_search";
}

export function createSearchProvider(): SearchProvider {
  if (env.WEB_SEARCH_PROVIDER === "exa") return new ExaSearchProvider();
  if (env.WEB_SEARCH_PROVIDER === "openai_web_search") return new OpenAIWebSearchProvider();
  return new DuckDuckGoSearchProvider();
}

export function createExtractProvider(): ExtractProvider {
  if (env.WEB_EXTRACT_PROVIDER === "exa") return new ExaContentsProvider();
  return new CheerioHtmlExtractProvider();
}
