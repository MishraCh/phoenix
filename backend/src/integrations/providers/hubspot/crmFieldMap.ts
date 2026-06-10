export type CrmModule = "companies" | "contacts";

/**
 * Curated concept → HubSpot property maps. Keys are lowercased/normalized
 * enrichment concept names; values are HubSpot internal property names.
 * Anything not matched is returned in `unmapped` (surfaced, never silently dropped).
 */
const COMPANY_MAP: Record<string, string> = {
  industry: "industry",
  sector: "industry",
  employees: "numberofemployees",
  employeecount: "numberofemployees",
  headcount: "numberofemployees",
  size: "numberofemployees",
  domain: "domain",
  website: "domain",
  url: "domain",
  city: "city",
  state: "state",
  country: "country",
  description: "description",
  about: "description",
  name: "name",
  phone: "phone",
  revenue: "annualrevenue",
  annualrevenue: "annualrevenue",
};

const CONTACT_MAP: Record<string, string> = {
  email: "email",
  firstname: "firstname",
  lastname: "lastname",
  title: "jobtitle",
  jobtitle: "jobtitle",
  role: "jobtitle",
  phone: "phone",
  company: "company",
  linkedin: "hs_linkedin_url",
  linkedinurl: "hs_linkedin_url",
  city: "city",
  country: "country",
};

/** Normalize an enrichment key: lowercase, strip non-alphanumerics. */
function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isEmpty(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === "string" && value.trim() === "");
}

/**
 * Map a raw enrichment object to HubSpot properties + the leftover (unmapped) fields.
 * Empty/null values are dropped from both.
 */
export function mapEnrichment(
  module: CrmModule,
  raw: Record<string, unknown>,
): { properties: Record<string, unknown>; unmapped: Record<string, unknown> } {
  const map = module === "companies" ? COMPANY_MAP : CONTACT_MAP;
  const properties: Record<string, unknown> = {};
  const unmapped: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(raw)) {
    if (isEmpty(value)) continue;
    const target = map[normalizeKey(key)];
    if (target) {
      properties[target] = value;
    } else {
      unmapped[key] = value;
    }
  }

  return { properties, unmapped };
}
