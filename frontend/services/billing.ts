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

export function createStripeCheckout(firebaseIdToken: string, plan: "plus" | "pro") {
  return apiFetch<{ url: string | null }>("/billing/checkout", {
    firebaseIdToken,
    method: "POST",
    body: JSON.stringify({ plan }),
  });
}

export function openStripePortal(firebaseIdToken: string) {
  return apiFetch<{ url: string }>("/billing/portal", {
    firebaseIdToken,
    method: "POST",
  });
}
