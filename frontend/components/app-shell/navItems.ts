import {
  CheckSquare,
  CircleDot,
  Command,
  Database,
  GitBranch,
  Library,
  Plug,
  Settings,
  Users,
} from "lucide-react";

export const mainNavItems = [
  { title: "Command Center", href: "/command-center", icon: Command },
  { title: "Agents", href: "/agents", icon: CircleDot },
  { title: "Workflows", href: "/workflows", icon: GitBranch },
  { title: "Approvals", href: "/approvals", icon: CheckSquare },
  { title: "Library", href: "/library", icon: Library },
  { title: "People", href: "/people", icon: Users },
  { title: "Integrations", href: "/integrations", icon: Plug },
  { title: "Memory", href: "/context", icon: Database },
] as const;

export const secondaryNavItems = [{ title: "Settings", href: "/settings", icon: Settings }] as const;

export const navItems = [...mainNavItems, ...secondaryNavItems] as const;

export const surfaceCopy = {
  "/command-center": {
    eyebrow: "Command Center",
    title: "Your command center",
    description:
      "Run commands, continue sessions, review active work, and see the latest outputs Gideon produced.",
    accent: "Today",
  },
  "/agents": {
    eyebrow: "Agents",
    title: "Your assistants",
    description:
      "Configure the specialists Gideon can use across research, planning, follow-up, and operations.",
    accent: "Assistants",
  },
  "/workflows": {
    eyebrow: "Workflows",
    title: "Repeatable workflows",
    description:
      "Turn recurring work into guided automations with templates, approvals, and custom steps.",
    accent: "Automation",
  },
  "/approvals": {
    eyebrow: "Approvals",
    title: "Review actions before they run",
    description:
      "Approve, edit, or reject emails, CRM updates, and other external actions.",
    accent: "Action required",
  },
  "/library": {
    eyebrow: "Library",
    title: "Saved outputs",
    description:
      "Artifacts, bookmarks, research reports, drafts, briefs, and workflow outputs — everything Gideon has saved for this workspace.",
    accent: "Library",
  },
  "/people": {
    eyebrow: "People",
    title: "People and relationship context",
    description:
      "Keep track of key contacts, company context, and the conversations that need follow-up.",
    accent: "People",
  },
  "/integrations": {
    eyebrow: "Integrations",
    title: "Connect the tools Gideon can use",
    description:
      "Bring in the systems that give Gideon the context it needs to help across your day.",
    accent: "Connections",
  },
  "/context": {
    eyebrow: "Memory",
    title: "Memory & Knowledge",
    description:
      "What Gideon knows about your workspace — memory facts, connected sources, and session context.",
    accent: "Memory",
  },
  "/settings": {
    eyebrow: "Settings",
    title: "Workspace settings",
    description:
      "Manage your profile, members, plan, notifications, and workspace preferences.",
    accent: "Settings",
  },
} as const;
