"use client";

import { FormEvent, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";
import {
  BookOpen,
  Bookmark,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  ExternalLink,
  File,
  FileText,
  ListTodo,
  Loader2,
  Plus,
  Presentation,
  Search,
  X,
} from "lucide-react";

import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { LoadingState } from "@/components/ui/LoadingState";
import { useToast } from "@/components/ui/ToastProvider";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/hooks/useAuth";
import { gideonQueryKeys, useArtifactsQuery, useSavedItemsQuery } from "@/hooks/useGideonQueries";
import { getFriendlyErrorMessage } from "@/lib/product";
import {
  createArtifact,
  fallbackArtifacts,
  fetchArtifact,
  type ArtifactDetail,
} from "@/services/artifacts";
import { deleteSavedItem } from "@/services/savedItems";

import { ProductHeader } from "./ProductHeader";
import { PageSection, SummaryRow, ToolbarRow } from "./ProductPrimitives";

// ── Constants ─────────────────────────────────────────────────────────────────

const CONTENT_TYPES = [
  { label: "All", value: null },
  { label: "Reports", value: "report" },
  { label: "Drafts", value: "draft" },
  { label: "Briefs", value: "summary" },
  { label: "Data outputs", value: "data" },
  { label: "Documents", value: "document" },
  { label: "Saved Responses", value: "saved_response" },
] as const;

type FilterValue = (typeof CONTENT_TYPES)[number]["value"];
type LibraryItem =
  | {
      kind: "artifact";
      id: string;
      title: string;
      artifactType: string;
      summary: string | null;
      createdAt: string;
    }
  | {
      kind: "saved_response";
      id: string;
      title: string;
      artifactType: "saved_response";
      summary: string;
      createdAt: string;
      contentText: string;
      promotedArtifactId: string | null;
    };

function artifactIcon(artifactType: string) {
  const t = artifactType.toLowerCase();
  if (t.includes("saved_response")) return Bookmark;
  if (t.includes("bookmark")) return Bookmark;
  if (t.includes("report")) return Presentation;
  if (t.includes("research")) return Search;
  if (t.includes("brief") || t.includes("summary")) return FileText;
  if (t.includes("draft")) return BookOpen;
  if (t.includes("task") || t.includes("todo") || t.includes("data")) return ListTodo;
  return File;
}

function artifactIconBg(type: string): string {
  const t = type.toLowerCase();
  if (t.includes("saved_response")) return "bg-muted text-foreground";
  if (t.includes("report"))   return "bg-[hsl(var(--badge-running-bg))] text-primary";
  if (t.includes("research")) return "bg-[#F5F0FF] text-purple-600";
  if (t.includes("brief") || t.includes("summary")) return "bg-[hsl(var(--badge-warning-bg))] text-[hsl(var(--badge-warning-text))]";
  if (t.includes("draft"))    return "bg-[hsl(var(--badge-success-bg))] text-[hsl(var(--badge-success-text))]";
  if (t.includes("data"))     return "bg-[#F0FAFF] text-cyan-600";
  if (t.includes("bookmark")) return "bg-[hsl(var(--badge-danger-bg))] text-[hsl(var(--badge-danger-text))]";
  return "bg-primary/5 text-primary";
}

function artifactBadgeBg(type: string): string {
  const t = type.toLowerCase();
  if (t.includes("saved_response")) return "border-border bg-muted/60 text-muted-foreground";
  if (t.includes("report"))   return "border-[hsl(var(--badge-running-border))] bg-[hsl(var(--badge-running-bg))] text-primary";
  if (t.includes("research")) return "border-purple-200 bg-[#F5F0FF] text-purple-600";
  if (t.includes("brief") || t.includes("summary")) return "border-[hsl(var(--badge-warning-border))] bg-[hsl(var(--badge-warning-bg))] text-[hsl(var(--badge-warning-text))]";
  if (t.includes("draft"))    return "border-[hsl(var(--badge-success-border))] bg-[hsl(var(--badge-success-bg))] text-[hsl(var(--badge-success-text))]";
  if (t.includes("data"))     return "border-cyan-200 bg-[#F0FAFF] text-cyan-600";
  return "border-border bg-background text-muted-foreground";
}

// ── Markdown rendering ────────────────────────────────────────────────────────

const mdComponents: Components = {
  p: ({ children }) => (
    <p className="text-[14.5px] leading-7 text-foreground/90 [&:not(:first-child)]:mt-3">{children}</p>
  ),
  h1: ({ children }) => (
    <h2 className="mt-6 text-lg font-semibold tracking-tight text-foreground first:mt-0">{children}</h2>
  ),
  h2: ({ children }) => (
    <h3 className="mt-5 text-[15px] font-semibold tracking-tight text-foreground first:mt-0">{children}</h3>
  ),
  h3: ({ children }) => (
    <h4 className="mt-4 text-[14px] font-semibold text-foreground first:mt-0">{children}</h4>
  ),
  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
  em: ({ children }) => <em className="italic text-foreground/80">{children}</em>,
  ul: ({ children }) => (
    <ul className="mt-3 space-y-1.5 pl-5 text-[14.5px] leading-7 text-foreground/90 [list-style-type:disc]">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="mt-3 space-y-1.5 pl-5 text-[14.5px] leading-7 text-foreground/90 [list-style-type:decimal]">
      {children}
    </ol>
  ),
  li: ({ children }) => <li className="text-[14.5px] leading-7">{children}</li>,
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="font-medium text-primary underline decoration-primary/25 underline-offset-4 hover:text-primary/80"
    >
      {children}
    </a>
  ),
  code: ({ children, className }) => {
    const isBlock = className?.includes("language-");
    if (isBlock) return <code className={`${className} text-xs`}>{children}</code>;
    return (
      <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[12px] text-foreground/85">
        {children}
      </code>
    );
  },
  pre: ({ children }) => (
    <pre className="mt-4 overflow-x-auto rounded-xl border border-border/55 bg-muted/40 p-4 text-xs leading-6 text-foreground/88">
      {children}
    </pre>
  ),
  blockquote: ({ children }) => (
    <blockquote className="mt-4 border-l-2 border-border/70 pl-4 text-[14.5px] leading-7 text-foreground/80">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-6 border-border/55" />,
  table: ({ children }) => (
    <div className="mt-4 overflow-x-auto rounded-xl border border-border/55 bg-background">
      <table className="w-full min-w-[420px] text-[14px]">{children}</table>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="border-b border-border/60 bg-muted/30">{children}</thead>
  ),
  th: ({ children }) => (
    <th className="px-4 py-3 text-left text-[12px] font-semibold text-foreground/72">{children}</th>
  ),
  td: ({ children }) => (
    <td className="px-4 py-3 align-top text-[14px] leading-6 text-foreground/82">{children}</td>
  ),
  tr: ({ children }) => <tr className="border-b border-border/40 last:border-0">{children}</tr>,
};

// ── Artifact modal ────────────────────────────────────────────────────────────

function ArtifactModal({
  artifactId,
  idToken,
  onClose,
}: {
  artifactId: string;
  idToken: string;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<ArtifactDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setLoadingDetail(true);
    setFetchError(null);
    fetchArtifact(idToken, artifactId)
      .then(setDetail)
      .catch((e: unknown) =>
        setFetchError(getFriendlyErrorMessage(e, "Couldn't load this output.")),
      )
      .finally(() => setLoadingDetail(false));
  }, [idToken, artifactId]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function handleCopy() {
    if (!detail?.content) return;
    await navigator.clipboard.writeText(detail.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  const wordCount =
    detail?.content ? detail.content.trim().split(/\s+/).filter(Boolean).length : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 px-0 pb-0 pt-16 backdrop-blur-sm sm:items-center sm:px-4 sm:pb-4"
      onClick={onClose}
    >
      <div
        className="relative flex w-full max-w-2xl flex-col overflow-hidden rounded-t-3xl bg-background shadow-2xl ring-1 ring-border sm:rounded-3xl"
        style={{ maxHeight: "85vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex shrink-0 items-start gap-3 border-b border-border px-6 py-4">
          <div className="min-w-0 flex-1">
            {loadingDetail ? (
              <div className="h-5 w-48 animate-pulse rounded-lg bg-muted" />
            ) : (
              <h2 className="text-base font-semibold leading-snug">
                {detail?.title ?? "Output"}
              </h2>
            )}
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
              {detail && (
                <>
                  <span className="rounded-full border border-border bg-muted/50 px-2.5 py-0.5 text-[11px] capitalize text-muted-foreground">
                    {detail.artifactType}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    {new Date(detail.createdAt).toLocaleString()}
                  </span>
                  {wordCount !== null && (
                    <span className="text-[11px] text-muted-foreground">
                      {wordCount.toLocaleString()} words
                    </span>
                  )}
                  {detail.sourceRefs.length > 0 && (
                    <span className="text-[11px] text-muted-foreground">
                      {detail.sourceRefs.length} source
                      {detail.sourceRefs.length !== 1 ? "s" : ""}
                    </span>
                  )}
                </>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ml-2 flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground"
            aria-label="Close"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Body — scrollable */}
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {loadingDetail ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Loading full content…
            </div>
          ) : fetchError ? (
            <p className="text-sm text-destructive">{fetchError}</p>
          ) : (
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
              {detail?.content ?? "No content available."}
            </ReactMarkdown>
          )}
        </div>

        {/* Footer */}
        {!loadingDetail && !fetchError && (
          <div className="flex shrink-0 items-center justify-between border-t border-border px-6 py-3">
            <p className="hidden text-[11px] text-muted-foreground sm:block">
              Press Esc to close
            </p>
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground transition hover:border-primary/40 hover:text-foreground"
            >
              {copied ? (
                <>
                  <Check className="size-3 text-green-500" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="size-3" />
                  Copy
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function SavedResponseModal({
  item,
  onClose,
}: {
  item: Extract<LibraryItem, { kind: "saved_response" }>;
  onClose: () => void;
}) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function handleCopy() {
    await navigator.clipboard.writeText(item.contentText);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 px-0 pb-0 pt-16 backdrop-blur-sm sm:items-center sm:px-4 sm:pb-4"
      onClick={onClose}
    >
      <div
        className="relative flex w-full max-w-2xl flex-col overflow-hidden rounded-t-3xl bg-background shadow-2xl ring-1 ring-border sm:rounded-3xl"
        style={{ maxHeight: "85vh" }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex shrink-0 items-start gap-3 border-b border-border px-6 py-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold leading-snug">{item.title}</h2>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="rounded-full border border-border bg-muted/50 px-2.5 py-0.5 text-[11px] text-muted-foreground">
                Saved response
              </span>
              <span className="text-[11px] text-muted-foreground">
                {new Date(item.createdAt).toLocaleString()}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ml-2 flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground"
            aria-label="Close"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
            {item.contentText}
          </ReactMarkdown>
        </div>

        <div className="flex shrink-0 items-center justify-between border-t border-border px-6 py-3">
          <p className="hidden text-[11px] text-muted-foreground sm:block">
            Saved from Command Center
          </p>
          <button
            type="button"
            onClick={() => void handleCopy()}
            className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground transition hover:border-primary/40 hover:text-foreground"
          >
            <Copy className="size-3" />
            Copy
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Library page ──────────────────────────────────────────────────────────────

export function LibraryPage() {
  const { pushToast } = useToast();
  const queryClient = useQueryClient();
  const { idToken } = useAuth();
  const artifactsQuery = useArtifactsQuery();
  const savedItemsQuery = useSavedItemsQuery();
  const [activeFilter, setActiveFilter] = useState<FilterValue>(null);
  const [expandedArtifactId, setExpandedArtifactId] = useState<string | null>(null);
  const [modalItem, setModalItem] = useState<LibraryItem | null>(null);
  const [showSaveForm, setShowSaveForm] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [saveType, setSaveType] = useState<"summary" | "report" | "draft" | "data" | "document">(
    "summary",
  );

  const SAVE_TYPES = [
    { label: "Brief", value: "summary" as const },
    { label: "Report", value: "report" as const },
    { label: "Draft", value: "draft" as const },
    { label: "Data output", value: "data" as const },
    { label: "Document", value: "document" as const },
  ];

  const allArtifacts = artifactsQuery.data?.artifacts ?? fallbackArtifacts;
  const savedResponses = savedItemsQuery.data?.savedItems ?? [];
  const allItems: LibraryItem[] = [
    ...allArtifacts.map((artifact) => ({
      kind: "artifact" as const,
      id: artifact.id,
      title: artifact.title,
      artifactType: artifact.artifactType,
      summary: artifact.summary ?? null,
      createdAt: artifact.createdAt,
    })),
    ...savedResponses.map((savedItem) => ({
      kind: "saved_response" as const,
      id: savedItem.id,
      title: savedItem.title,
      artifactType: "saved_response" as const,
      summary: savedItem.previewText,
      createdAt: savedItem.createdAt,
      contentText: savedItem.contentText,
      promotedArtifactId: savedItem.promotedArtifactId,
    })),
  ].sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());

  const artifacts = activeFilter
    ? allItems.filter((item) => item.artifactType.toLowerCase() === activeFilter)
    : allItems;
  const loading = (artifactsQuery.isLoading && !artifactsQuery.data) || (savedItemsQuery.isLoading && !savedItemsQuery.data);
  const error =
    actionError ??
    (savedItemsQuery.error
      ? getFriendlyErrorMessage(savedItemsQuery.error, "We couldn't load saved responses yet.")
      : null) ??
    (artifactsQuery.error
      ? getFriendlyErrorMessage(artifactsQuery.error, "We couldn't load saved outputs yet.")
      : null);

  async function handleDeleteSavedResponse(savedItemId: string) {
    if (!idToken) return;

    try {
      await deleteSavedItem(idToken, savedItemId);
      await queryClient.invalidateQueries({ queryKey: gideonQueryKeys.savedItems(idToken) });
      setExpandedArtifactId((current) => (current === `saved:${savedItemId}` ? null : current));
      setModalItem((current) => (current?.kind === "saved_response" && current.id === savedItemId ? null : current));
      pushToast({
        title: "Removed from library",
        description: "The saved response was removed from Saved Responses.",
        tone: "success",
      });
    } catch (nextError) {
      const message = getFriendlyErrorMessage(nextError, "We couldn't remove that saved response yet.");
      setActionError(message);
      pushToast({
        title: "Remove needs attention",
        description: message,
        tone: "error",
      });
    }
  }

  async function handleCreateArtifact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!title.trim() || !content.trim() || !idToken) return;

    try {
      const result = await createArtifact(idToken, {
        title,
        artifactType: saveType,
        content,
      });

      queryClient.setQueryData(
        gideonQueryKeys.artifacts(idToken),
        (current: typeof artifactsQuery.data) => ({
          artifacts: [
            {
              id: result.artifactId,
              title,
              artifactType: saveType,
              summary: content,
              createdAt: new Date().toISOString(),
            },
            ...(current?.artifacts ?? []),
          ],
        }),
      );

      setActionError(null);
      pushToast({
        title: "Saved to library",
        description: "Your output is now in the library.",
        tone: "success",
      });
      setTitle("");
      setContent("");
    } catch (nextError) {
      const message = getFriendlyErrorMessage(nextError, "We couldn't save that output yet.");
      setActionError(message);
      pushToast({
        title: "Save needs attention",
        description: message,
        tone: "error",
      });
    }
  }

  return (
    <section className="space-y-6">
      <ProductHeader
        eyebrow="Library"
        title="Saved outputs"
        description="Artifacts, saved responses, research reports, drafts, briefs, and workflow outputs — everything Gideon has intentionally preserved for this workspace."
        meta={
          <SummaryRow
            className="md:grid-cols-3 xl:grid-cols-3"
            items={[
              {
                label: "Saved outputs",
                value: allItems.length,
                detail: "Everything intentionally preserved for later reference.",
                icon: BookOpen,
                tone: allItems.length > 0 ? "primary" : "neutral",
              },
              {
                label: "Visible now",
                value: artifacts.length,
                detail: activeFilter ? "Items currently shown by the active filter." : "Items currently visible in the library.",
                icon: Search,
                tone: "neutral",
              },
              {
                label: "Drafts & reports",
                value: allItems.filter((item) => ["draft", "report", "summary"].includes(item.artifactType.toLowerCase())).length,
                detail: "Longer-form outputs that usually carry the most decision value.",
                icon: Presentation,
                tone: "success",
              },
            ]}
          />
        }
      />

      {error ? <ErrorState message={error} onRetry={() => { void artifactsQuery.refetch(); void savedItemsQuery.refetch(); }} /> : null}

      <ToolbarRow>
      <div className="flex gap-2 flex-wrap">
        {CONTENT_TYPES.map(({ label, value }) => (
          <button
            key={label}
            onClick={() => setActiveFilter(value)}
            className={[
              "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
              activeFilter === value
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-background text-muted-foreground hover:text-foreground hover:border-foreground/30",
            ].join(" ")}
          >
            {label}
          </button>
        ))}
      </div>
      </ToolbarRow>

      <div className="grid gap-6 xl:grid-cols-[1fr_22rem]">
        <PageSection
          className="p-0"
          title="Library contents"
          description="Browse saved outputs, expand for a quick preview, or open the full detail view."
          contentClassName="mt-0"
        >
        <Card className="overflow-hidden rounded-none border-0 bg-transparent shadow-none">
          <CardContent className="p-0">
            {loading ? (
              <div className="p-5">
                <LoadingState label="Loading saved outputs..." rows={3} />
              </div>
            ) : artifacts.length > 0 ? (
              <div className="divide-y divide-border">
                {artifacts.map((artifact) => {
                  const ArtifactIcon = artifactIcon(artifact.artifactType);
                  const expandedKey = artifact.kind === "saved_response" ? `saved:${artifact.id}` : artifact.id;
                  const isExpanded = expandedArtifactId === expandedKey;

                  return (
                    <article
                      key={expandedKey}
                      className="cursor-pointer px-5 py-5 transition-colors hover:bg-muted/50"
                      onClick={() => setExpandedArtifactId(isExpanded ? null : expandedKey)}
                    >
                      <div className="grid gap-4 md:grid-cols-[1fr_9rem_11rem] items-center">
                        <div className="flex items-start gap-4">
                          <div className={`flex size-10 shrink-0 items-center justify-center rounded-xl shadow-sm ring-1 ring-border/60 ${artifactIconBg(artifact.artifactType)}`}>
                            <ArtifactIcon className="size-5" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <h3 className="font-semibold">{artifact.title}</h3>
                              {isExpanded ? (
                                <ChevronUp className="size-3.5 shrink-0 text-muted-foreground" />
                              ) : (
                                <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
                              )}
                            </div>
                            {!isExpanded && (
                              <p className="mt-1 text-sm leading-6 text-muted-foreground line-clamp-2">
                                {artifact.summary ?? "Click to expand."}
                              </p>
                            )}
                          </div>
                        </div>
                        <span className={`rounded-full border px-3 py-1 text-xs capitalize font-medium ${artifactBadgeBg(artifact.artifactType)}`}>
                          {artifact.artifactType === "saved_response" ? "Saved response" : artifact.artifactType}
                        </span>
                        <span className="text-sm text-muted-foreground">
                          {new Date(artifact.createdAt).toLocaleString()}
                        </span>
                      </div>

                      {isExpanded && (
                        <div className="mt-4 space-y-2">
                          {/* Summary preview */}
                          <div className="max-h-64 overflow-y-auto rounded-2xl bg-muted/40 px-5 py-4 text-sm leading-6 text-foreground">
                            {artifact.summary ? (
                              <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                                {artifact.summary}
                              </ReactMarkdown>
                            ) : (
                              "No preview available."
                            )}
                          </div>
                          {/* Actions */}
                          <div className="flex items-center justify-end gap-3">
                            {artifact.kind === "saved_response" ? (
                              <>
                                <p className="text-[11px] text-muted-foreground">
                                  Saved from Command Center
                                </p>
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    void handleDeleteSavedResponse(artifact.id);
                                  }}
                                  className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition hover:text-foreground"
                                >
                                  Remove
                                </button>
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setModalItem(artifact);
                                  }}
                                  className="inline-flex items-center gap-1 text-xs font-medium text-primary transition hover:underline"
                                >
                                  Open full response
                                  <ExternalLink className="size-3" />
                                </button>
                              </>
                            ) : (
                              <>
                            <p className="text-[11px] text-muted-foreground">
                              Preview only — may be truncated
                            </p>
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                setModalItem(artifact);
                              }}
                              className="inline-flex items-center gap-1 text-xs font-medium text-primary transition hover:underline"
                            >
                              Open full output
                              <ExternalLink className="size-3" />
                            </button>
                              </>
                            )}
                          </div>
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="p-5">
                <EmptyState
                  icon={<FileText className="size-6" />}
                  title="Nothing here yet"
                  description={
                    activeFilter
                      ? `No ${activeFilter === "saved_response" ? "saved responses" : activeFilter} saved yet. Run a command or workflow to generate one.`
                      : "Briefs, research reports, drafts, workflow outputs, and intentionally saved responses will appear here once Gideon starts saving work for you."
                  }
                />
              </div>
            )}
          </CardContent>
        </Card>
        </PageSection>

        <Card className="h-fit">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">Save something new</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 rounded-full px-3 text-xs"
                onClick={() => setShowSaveForm((v) => !v)}
              >
                {showSaveForm ? (
                  <>
                    <ChevronUp className="mr-1.5 size-3" />
                    Cancel
                  </>
                ) : (
                  <>
                    <ChevronDown className="mr-1.5 size-3" />
                    Save new
                  </>
                )}
              </Button>
            </div>
            {showSaveForm ? (
              <>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  Manually capture a note, summary, or draft so it stays with the rest of your
                  workspace library.
                </p>
                <form onSubmit={handleCreateArtifact} className="mt-5 space-y-4">
                  <div>
                    <label className="block text-sm font-medium" htmlFor="artifact-title">
                      Title
                    </label>
                    <input
                      id="artifact-title"
                      value={title}
                      onChange={(event) => setTitle(event.target.value)}
                      className="mt-2 min-h-11 w-full rounded-2xl border border-input px-3 text-sm outline-none ring-primary/20 focus:ring-4"
                      placeholder="Weekly leadership brief"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium" htmlFor="artifact-type">
                      Type
                    </label>
                    <select
                      id="artifact-type"
                      value={saveType}
                      onChange={(event) => setSaveType(event.target.value as typeof saveType)}
                      className="mt-2 min-h-11 w-full rounded-2xl border border-input bg-background px-3 text-sm outline-none ring-primary/20 focus:ring-4"
                    >
                      {SAVE_TYPES.map(({ label, value }) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium" htmlFor="artifact-content">
                      Content
                    </label>
                    <textarea
                      id="artifact-content"
                      value={content}
                      onChange={(event) => setContent(event.target.value)}
                      className="mt-2 min-h-32 w-full rounded-2xl border border-input px-3 py-3 text-sm outline-none ring-primary/20 focus:ring-4"
                      placeholder="Capture the key points you want to keep close."
                    />
                  </div>
                  <Button type="submit" className="w-full">
                    <Plus className="mr-2 size-4" />
                    Save to library
                  </Button>
                </form>
              </>
            ) : (
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Manually save a note, brief, or draft to keep it in the workspace library.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Full-content modal */}
      {modalItem?.kind === "artifact" && idToken ? (
        <ArtifactModal
          artifactId={modalItem.id}
          idToken={idToken}
          onClose={() => setModalItem(null)}
        />
      ) : null}
      {modalItem?.kind === "saved_response" ? (
        <SavedResponseModal item={modalItem} onClose={() => setModalItem(null)} />
      ) : null}
    </section>
  );
}
