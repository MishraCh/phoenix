"use client";

import {
  clearActiveIntegrationContext,
  readActiveIntegrationContext,
  subscribeToActiveIntegrationContext,
  writeActiveIntegrationContext,
} from "./activeIntegrationContext";

export type ActiveGmailContext = {
  provider: "gmail";
  threadId: string;
  title: string;
  contextBundleId: string;
};

export function readActiveGmailContext(): ActiveGmailContext | null {
  const active = readActiveIntegrationContext();

  if (!active || active.provider !== "gmail") {
    return null;
  }

  return {
    provider: "gmail",
    threadId: active.itemId,
    title: active.title,
    contextBundleId: active.contextBundleId,
  };
}

export function writeActiveGmailContext(value: ActiveGmailContext) {
  writeActiveIntegrationContext({
    provider: "gmail",
    itemId: value.threadId,
    title: value.title,
    contextBundleId: value.contextBundleId,
  });
}

export function clearActiveGmailContext() {
  clearActiveIntegrationContext("gmail");
}

export function subscribeToActiveGmailContext(callback: () => void) {
  return subscribeToActiveIntegrationContext(() => {
    if (readActiveIntegrationContext()?.provider === "gmail" || !readActiveIntegrationContext()) {
      callback();
    }
  });
}
