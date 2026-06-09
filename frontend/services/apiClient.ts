import { getFirebaseAuth } from "../lib/firebase";

export const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || (process.env.NODE_ENV === "production" ? "" : "http://localhost:3001");

export function getStoredFirebaseIdToken() {
  if (typeof window === "undefined") {
    return null;
  }

  return window.localStorage.getItem("gideon:firebaseIdToken");
}

let tokenRefreshPromise: Promise<string> | null = null;

async function getFreshFirebaseIdToken(force = false) {
  const auth = getFirebaseAuth();
  if (!auth?.currentUser) {
    return null;
  }

  if (!tokenRefreshPromise) {
    tokenRefreshPromise = auth.currentUser
      .getIdToken(force)
      .then((token) => {
        if (typeof window !== "undefined") {
          window.localStorage.setItem("gideon:firebaseIdToken", token);
        }
        return token;
      })
      .finally(() => {
        tokenRefreshPromise = null;
      });
  }

  return tokenRefreshPromise;
}

export async function apiFetch<TResponse>(
  path: string,
  options: RequestInit & { firebaseIdToken: string },
) {
  let token = (await getFreshFirebaseIdToken(false)) ?? options.firebaseIdToken;

  const makeRequest = (authToken: string) => fetch(`${apiBaseUrl}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${authToken}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  let response = await makeRequest(token);

  if (response.status === 401) {
    try {
      const refreshedToken = await getFreshFirebaseIdToken(true);
      if (refreshedToken) {
        token = refreshedToken;
        response = await makeRequest(token);
      }
    } catch {
      // Fall through to error handling if refresh fails
    }
  }

  if (!response.ok) {
    const errorBody = await response.json().catch(() => null);
    throw new Error(errorBody?.message ?? `Request failed with status ${response.status}`);
  }

  if (response.status === 204) {
    return undefined as TResponse;
  }

  return response.json() as Promise<TResponse>;
}
