import { apiFetch } from "./apiClient";

export function applyCoupon(firebaseIdToken: string, couponCode: string) {
  return apiFetch<{
    plan: "plus" | "pro";
    creditsGranted: number;
    planExpiresAt: string | null;
  }>("/billing/apply-coupon", {
    firebaseIdToken,
    method: "POST",
    body: JSON.stringify({ couponCode }),
  });
}
