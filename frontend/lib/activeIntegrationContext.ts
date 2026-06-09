"use client";

export type ActiveIntegrationContext = {
  provider: "gmail" | "hubspot";
  contextBundleId: string;
  itemId: string;
  title: string;
  subtitle?: string;
  selectedAt: string;
};

const STORAGE_KEY = "gideon:active-integration-context";
const CHANGE_EVENT = "gideon:integration-context-changed";

function hasWindow() {
  return typeof window !== "undefined";
}

export function readActiveIntegrationContext(): ActiveIntegrationContext | null {
  if (!hasWindow()) {
    return null;
  }

  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as ActiveIntegrationContext;
    if (!parsed?.contextBundleId || !parsed?.itemId || !parsed?.provider) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

export function writeActiveIntegrationContext(
  value: Omit<ActiveIntegrationContext, "selectedAt"> & { selectedAt?: string },
) {
  if (!hasWindow()) {
    return;
  }

  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      ...value,
      selectedAt: value.selectedAt ?? new Date().toISOString(),
    }),
  );
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function clearActiveIntegrationContext(provider?: ActiveIntegrationContext["provider"]) {
  if (!hasWindow()) {
    return;
  }

  if (!provider) {
    window.localStorage.removeItem(STORAGE_KEY);
    window.dispatchEvent(new Event(CHANGE_EVENT));
    return;
  }

  const current = readActiveIntegrationContext();
  if (current?.provider === provider) {
    window.localStorage.removeItem(STORAGE_KEY);
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }
}

export function subscribeToActiveIntegrationContext(callback: () => void) {
  if (!hasWindow()) {
    return () => {};
  }

  const handler = () => callback();
  window.addEventListener(CHANGE_EVENT, handler);
  window.addEventListener("storage", handler);

  return () => {
    window.removeEventListener(CHANGE_EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}
