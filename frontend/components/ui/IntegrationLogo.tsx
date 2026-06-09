"use client";

import {
  siGoogle,
  siNotion,
  siHubspot,
  siStripe,
  siLinear,
  siJira,
  siZendesk,
  siZoom,
  siCalendly,
} from "simple-icons";
import type { SimpleIcon } from "simple-icons";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

const PROVIDER_ICONS: Record<string, SimpleIcon> = {
  google: siGoogle,
  notion: siNotion,
  hubspot: siHubspot,
  stripe: siStripe,
  linear: siLinear,
  jira: siJira,
  zendesk: siZendesk,
  zoom: siZoom,
  calendly: siCalendly,
};

type IntegrationLogoProps = {
  providerId: string;
  fallbackIcon: LucideIcon;
  className?: string;
};

export function IntegrationLogo({ providerId, fallbackIcon: FallbackIcon, className }: IntegrationLogoProps) {
  const icon = PROVIDER_ICONS[providerId];

  if (icon) {
    return (
      <svg
        role="img"
        viewBox="0 0 24 24"
        className={cn("size-4 fill-current", className)}
        aria-label={icon.title}
      >
        <path d={icon.path} />
      </svg>
    );
  }

  return <FallbackIcon className={cn("size-4", className)} />;
}
