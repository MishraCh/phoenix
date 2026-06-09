import type { z } from "zod";

import { planSchema } from "../schemas/coreSchemas.js";

export type BillingPlan = z.infer<typeof planSchema>;

export type CouponDefinition = {
  code: string;
  planGranted: Exclude<BillingPlan, "free">;
  creditsGranted: number;
  expiresInDays: number | null;
};

export const couponDefinitions = {
  GIDEON_PLUS_2026: {
    code: "GIDEON_PLUS_2026",
    planGranted: "plus",
    creditsGranted: 1500,
    expiresInDays: null,
  },
  GIDEON_PRO_2026: {
    code: "GIDEON_PRO_2026",
    planGranted: "pro",
    creditsGranted: 7500,
    expiresInDays: null,
  },
  INTERNAL_PRO_2026: {
    code: "INTERNAL_PRO_2026",
    planGranted: "pro",
    creditsGranted: 25000,
    expiresInDays: null,
  },
} satisfies Record<string, CouponDefinition>;

export function normalizeCouponCode(code: string) {
  return code.trim().toUpperCase();
}

export function getCouponDefinition(code: string) {
  return couponDefinitions[normalizeCouponCode(code) as keyof typeof couponDefinitions] ?? null;
}
