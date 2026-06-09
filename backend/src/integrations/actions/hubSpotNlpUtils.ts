/**
 * Shared HubSpot NLP utilities used by both the CommandRouterV2 and
 * HubSpotActionService to extract structured update intents from
 * natural-language user queries.
 *
 * Centralised here to prevent divergence between the two consumers.
 */

export const HUBSPOT_UPDATE_FIELD_ALIASES: Record<string, string> = {
  title: "jobtitle",
  "job title": "jobtitle",
  occupation: "jobtitle",
  email: "email",
  phone: "phone",
  stage: "dealstage",
  "deal stage": "dealstage",
  "lifecycle stage": "lifecyclestage",
};

const FIELD_NAMES_PATTERN = Object.keys(HUBSPOT_UPDATE_FIELD_ALIASES)
  .sort((a, b) => b.length - a.length) // Longest first for greedy match
  .join("|");

/**
 * Attempts to parse a HubSpot property update from a natural-language query.
 *
 * Supported patterns:
 *   • "update the <field> of <target> to <value>"
 *   • "set <target>'s <field> to <value>"
 *
 * Returns `null` when the query does not match a recognised update pattern.
 */
export function extractHubSpotUpdate(
  query: string,
): { targetQuery: string; updates: Record<string, string> } | null {
  const direct = query.match(
    new RegExp(
      `\\b(?:update|change|set)\\s+(?:the\\s+)?(${FIELD_NAMES_PATTERN})\\s+(?:of|for)\\s+(.+?)\\s+to\\s+(.+?)\\s*$`,
      "i",
    ),
  );
  const possessive = query.match(
    new RegExp(
      `\\b(?:update|change|set)\\s+(.+?)(?:'s|\\s+)(${FIELD_NAMES_PATTERN})\\s+to\\s+(.+?)\\s*$`,
      "i",
    ),
  );
  const match = direct ?? possessive;
  if (!match) return null;

  const field = direct ? match[1] : match[2];
  const targetQuery = direct ? match[2] : match[1];
  const value = match[3].replace(
    /\s+(?:in|on|from)\s+(?:hubspot|the crm|crm)\s*$/i,
    "",
  );
  const property = HUBSPOT_UPDATE_FIELD_ALIASES[field.toLowerCase()];
  return property && targetQuery && value
    ? { targetQuery: targetQuery.trim(), updates: { [property]: value.trim() } }
    : null;
}
