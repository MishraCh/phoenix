import { Link2, Search, Wand2, Workflow } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import type { CommandMode, CommandResponse } from "@/services/command";
import type { SessionListItem } from "@/services/commandSessions";

export type SessionMessage = {
  id: string;
  assistantMessageId: string | null;
  userQuery: string;
  mode: CommandMode;
  agentId: string | null;
  agentName: string | null;
  status: "running" | "completed" | "error";
  response: CommandResponse | null;
  statusCopy: string;
  starred: boolean;
  savedItemId: string | null;
};

export type SlashModeConfig = {
  slash: string;
  mode: Exclude<CommandMode, "auto">;
  label: string;
  description: string;
  icon: LucideIcon;
  advanced?: boolean;
};

export const slashModes: SlashModeConfig[] = [
  {
    slash: "/search",
    mode: "search",
    label: "Search",
    description: "Fast sourced discovery with concise results.",
    icon: Search,
  },
  {
    slash: "/research",
    mode: "research",
    label: "Research",
    description: "Manual deep report mode for slower, source-backed investigations.",
    icon: Wand2,
    advanced: true,
  },
  {
    slash: "/extract",
    mode: "extract_url",
    label: "Extract URL",
    description: "Pull and summarize a known public page or article.",
    icon: Link2,
  },
  {
    slash: "/workflow",
    mode: "workflow",
    label: "Workflow",
    description: "Turn a repeatable request into a draft workflow.",
    icon: Workflow,
  },
];

export const quickSlashModes = slashModes.filter((mode) => !mode.advanced);

export function modeLabel(mode: Exclude<CommandMode, "auto">) {
  return slashModes.find((item) => item.mode === mode)?.slash ?? `/${mode}`;
}

export type Session = SessionListItem;

export function statusCopyForMode(mode: CommandMode) {
  switch (mode) {
    case "search":
      return "Searching public sources...";
    case "research":
      return "Researching with source-backed context...";
    case "extract_url":
      return "Extracting the page...";
    case "workflow":
      return "Drafting a workflow...";
    default:
      return "Running your request...";
  }
}
