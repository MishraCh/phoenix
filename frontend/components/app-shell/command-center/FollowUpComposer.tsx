"use client";

import { FormEvent, useRef, useState } from "react";
import { ArrowUp, Bot, Link2, Plus, Search, Wand2, Workflow, X } from "lucide-react";

import { useToast } from "@/components/ui/ToastProvider";
import { Button } from "@/components/ui/button";
import type { ActiveIntegrationContext } from "@/lib/activeIntegrationContext";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { VisibleAgent } from "@/services/agents";
import type { CommandMode } from "@/services/command";

import { modeLabel, slashModes } from "./types";

type FollowUpComposerProps = {
  selectedMode: Exclude<CommandMode, "auto"> | null;
  selectedAgentId: string | null;
  activeIntegrationContext: ActiveIntegrationContext | null;
  onClearIntegrationContext: () => void;
  availableAgents: VisibleAgent[];
  isRunning: boolean;
  onSelectMode: (mode: Exclude<CommandMode, "auto"> | null) => void;
  onSelectAgent: (id: string | null) => void;
  onSubmit: (query: string, mode: CommandMode, agentId: string | null) => void;
};

export function FollowUpComposer({
  selectedMode,
  selectedAgentId,
  activeIntegrationContext,
  onClearIntegrationContext,
  availableAgents,
  isRunning,
  onSelectMode,
  onSelectAgent,
  onSubmit,
}: FollowUpComposerProps) {
  const { pushToast } = useToast();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState("");

  const selectedAgent = availableAgents.find((a) => a.id === selectedAgentId) ?? null;
  const placeholder = activeIntegrationContext
    ? activeIntegrationContext.provider === "gmail"
      ? "Ask about the selected Gmail thread, draft a reply, or extract action items..."
      : "Ask about the selected HubSpot record, summarize it, or plan a follow-up..."
    : "Ask a follow-up, or type /search, /extract, /workflow...";

  function handleAddUrl() {
    setText((t) => (t.includes("http") ? t : `${t}${t ? "\n" : ""}https://`));
    textareaRef.current?.focus();
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || isRunning) return;

    // Parse slash command override
    let submittedMode: CommandMode = selectedMode ?? "auto";
    let query = trimmed;
    const slashMatch = trimmed.match(/^\/(search|research|extract|workflow)\b\s*/i);
    if (slashMatch) {
      const matchedMode = slashModes.find(
        (m) =>
          m.slash.slice(1).toLowerCase() === slashMatch[1].toLowerCase() ||
          (slashMatch[1].toLowerCase() === "extract" && m.mode === "extract_url"),
      );
      if (matchedMode) {
        submittedMode = matchedMode.mode;
        query = trimmed.slice(slashMatch[0].length).trim() || trimmed;
      }
    }

    onSubmit(query, submittedMode, selectedAgentId);
    setText("");
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-[2rem] border border-border/40 bg-white/95 p-1 shadow-[0_4px_24px_rgba(30,20,80,0.06)] transition-all duration-150 focus-within:ring-4 focus-within:ring-primary/10 hover:shadow-panel"
    >
      {activeIntegrationContext ? (
        <div className="flex items-start justify-between gap-3 border-b border-primary/10 bg-primary/5 px-3 py-2">
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold text-primary">
              Pinned {activeIntegrationContext.provider === "gmail" ? "Gmail thread" : "HubSpot record"}:{" "}
              <span className="font-semibold">{activeIntegrationContext.title}</span>
            </p>
            <p className="mt-1 text-[11px] leading-5 text-primary/80">
              This keeps the selected item in scope for this chat. Clear removes the pin only.
            </p>
          </div>
          <button
            type="button"
            onClick={onClearIntegrationContext}
            className="shrink-0 rounded-full px-2 py-1 text-[11px] font-semibold text-primary hover:bg-primary/10"
          >
            Clear
          </button>
        </div>
      ) : null}
      {(selectedMode || selectedAgent) ? (
        <div className="flex flex-wrap gap-1.5 px-3 pt-2 pb-0">
          {selectedMode ? (
            <button
              type="button"
              onClick={() => onSelectMode(null)}
              className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/5 px-2.5 py-0.5 text-[11px] font-medium text-primary"
            >
              {modeLabel(selectedMode)}
              <X className="size-2.5" />
            </button>
          ) : null}
          {selectedAgent ? (
            <button
              type="button"
              onClick={() => onSelectAgent(null)}
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-0.5 text-[11px] font-medium text-foreground"
            >
              <Bot className="size-3 text-primary" />
              {selectedAgent.name}
              <X className="size-2.5" />
            </button>
          ) : null}
        </div>
      ) : null}

      {/* Single-row: + | textarea | send */}
      <div className="flex items-end gap-1 px-2 py-1.5">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" size="icon" variant="ghost" className="mb-0.5 size-7 shrink-0 rounded-full text-muted-foreground/50 hover:text-foreground">
              <Plus className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-[18rem]">
            <DropdownMenuLabel>Options</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault();
                handleAddUrl();
              }}
            >
              <Link2 className="mr-2 size-4" />
              Add URL
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Search className="mr-2 size-4" />
                Choose mode
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem onSelect={() => onSelectMode(null)}>Default</DropdownMenuItem>
                {slashModes.map((mode) => (
                  <DropdownMenuItem key={mode.mode} onSelect={() => onSelectMode(mode.mode)}>
                    {mode.slash}{mode.advanced ? " (manual deep report)" : ""}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Bot className="mr-2 size-4" />
                Choose agent
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-[20rem]">
                <DropdownMenuItem onSelect={() => onSelectAgent(null)}>No specific agent</DropdownMenuItem>
                {availableAgents.map((agent: VisibleAgent) => {
                  const isActive = agent.status === "active";
                  return (
                    <DropdownMenuItem
                      key={agent.id}
                      onSelect={() => {
                        if (!isActive) {
                          pushToast({
                            title: `${agent.name} isn't active`,
                            description:
                              agent.status === "disabled"
                                ? "This agent is disabled. Enable it on the Agents page."
                                : "Activate this agent on the Agents page to use it in commands.",
                            tone: "default",
                          });
                          return;
                        }
                        onSelectAgent(agent.id);
                      }}
                      className={isActive ? "" : "opacity-50"}
                    >
                      <div className="space-y-0.5">
                        <p className="text-sm font-medium">
                          {agent.name}
                          {!isActive && (
                            <span className="ml-2 text-xs font-normal text-muted-foreground">
                              ({agent.status === "disabled" ? "disabled" : "needs setup"})
                            </span>
                          )}
                        </p>
                        {agent.description ? (
                          <p className="text-xs leading-5 text-muted-foreground">{agent.description}</p>
                        ) : null}
                      </div>
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </DropdownMenuContent>
        </DropdownMenu>

        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void handleSubmit(e as unknown as FormEvent);
            }
          }}
          placeholder={placeholder}
          disabled={isRunning}
          rows={1}
          className="flex-1 min-h-[32px] max-h-[120px] resize-none bg-transparent py-1.5 text-sm outline-none placeholder:text-muted-foreground/50 disabled:opacity-50"
        />

        <Button
          type="submit"
          size="icon"
          disabled={!text.trim() || isRunning}
          className="mb-0.5 size-8 shrink-0 rounded-full bg-primary text-primary-foreground shadow-sm hover:bg-primary/90"
        >
          <ArrowUp className="size-3.5" />
        </Button>
      </div>
    </form>
  );
}
