"use client";

import { FormEvent, useMemo, useState } from "react";
import { Building2, Check, ChevronDown, Plus } from "lucide-react";

import { useWorkspace } from "@/hooks/useWorkspace";
import { getDefaultWorkspaceName, getFriendlyErrorMessage } from "@/lib/product";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

type WorkspaceAction = "create" | "join" | null;

export function WorkspaceSwitcher({ collapsed = false }: { collapsed?: boolean }) {
  const {
    createWorkspace,
    error,
    joinWorkspace,
    loading,
    me,
    selectedWorkspace,
    selectingWorkspaceId,
    selectWorkspace,
    workspaces,
  } = useWorkspace();
  const [activeAction, setActiveAction] = useState<WorkspaceAction>(null);
  const [workspaceName, setWorkspaceName] = useState("");
  const [inviteWorkspaceId, setInviteWorkspaceId] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const suggestedWorkspaceName = useMemo(
    () => getDefaultWorkspaceName(me?.displayName, me?.email),
    [me?.displayName, me?.email],
  );

  async function handleCreateWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);

    try {
      await createWorkspace(workspaceName || suggestedWorkspaceName);
      setStatus("Workspace created and selected.");
      setWorkspaceName("");
      setActiveAction(null);
    } catch (nextError) {
      setStatus(getFriendlyErrorMessage(nextError, "We couldn't create that workspace yet."));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleJoinWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);

    try {
      await joinWorkspace({
        workspaceId: inviteWorkspaceId.trim(),
        inviteCode: inviteCode.trim(),
      });
      setStatus("Workspace joined and selected.");
      setInviteWorkspaceId("");
      setInviteCode("");
      setActiveAction(null);
    } catch (nextError) {
      setStatus(getFriendlyErrorMessage(nextError, "We couldn't join that workspace yet."));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSelectWorkspace(workspaceId: string) {
    setStatus(null);

    try {
      await selectWorkspace(workspaceId);
    } catch (nextError) {
      setStatus(getFriendlyErrorMessage(nextError, "We couldn't switch workspaces yet."));
    }
  }

  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex justify-center px-1">
            <div className="flex size-11 items-center justify-center rounded-2xl bg-muted/60 text-muted-foreground">
              <Building2 className="size-4" />
            </div>
          </div>
        </TooltipTrigger>
        <TooltipContent side="right">
          {loading ? "Loading workspace..." : selectedWorkspace?.name ?? "Choose a workspace"}
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <>
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                className="h-11 flex-1 min-w-0 overflow-hidden justify-between rounded-2xl border-border/60 bg-white/70 px-3 shadow-none hover:bg-white hover:border-border/80 text-foreground"
              >
                <span className="flex min-w-0 flex-1 items-center gap-2.5 overflow-hidden text-left">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                    <Building2 className="size-3.5" />
                  </span>
                  <span className="min-w-0 flex-1 overflow-hidden">
                    <span className="block truncate text-sm font-medium text-foreground">
                      {loading ? "Loading workspace..." : selectedWorkspace?.name ?? "Choose a workspace"}
                    </span>
                  </span>
                  {selectedWorkspace && !loading ? (
                    <Badge className="shrink-0 rounded-full px-2 py-0 text-[10px] capitalize bg-muted/80 text-muted-foreground border-0">
                      {selectedWorkspace.plan}
                    </Badge>
                  ) : null}
                </span>
                <ChevronDown className="ml-2 size-4 text-muted-foreground/60 shrink-0" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-[17rem]">
              <DropdownMenuLabel>Your workspaces</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {loading ? (
                <div className="space-y-2 p-2">
                  <Skeleton className="h-9 w-full" />
                  <Skeleton className="h-9 w-full" />
                </div>
              ) : workspaces.length > 0 ? (
                workspaces.map((workspace) => (
                  <DropdownMenuItem
                    key={workspace.id}
                    onClick={() => void handleSelectWorkspace(workspace.id)}
                    className="justify-between"
                    disabled={selectingWorkspaceId === workspace.id}
                  >
                    <span className="truncate">{workspace.name}</span>
                    {selectedWorkspace?.id === workspace.id ? <Check className="size-4 text-primary" /> : null}
                  </DropdownMenuItem>
                ))
              ) : (
                <div className="px-3 py-3 text-sm text-muted-foreground">
                  Your workspaces will appear here once you create or join one.
                </div>
              )}
              <DropdownMenuSeparator />
              <div className="px-3 py-2 text-xs leading-5 text-muted-foreground">
                {error ?? status ?? "Choose the workspace you want Gideon to use across this session."}
              </div>
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                className="size-10 rounded-2xl border-border/60 bg-white/70 text-muted-foreground shadow-none hover:bg-white hover:text-foreground hover:border-border/80"
              >
                <Plus className="size-4" />
                <span className="sr-only">Workspace actions</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>Workspace actions</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setActiveAction("create")}>
                Create new workspace
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setActiveAction("join")}>
                Join workspace with invite code
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {error || status ? (
          <p className="px-1 text-xs leading-5 text-muted-foreground/70">{error ?? status}</p>
        ) : null}
      </div>

      <Dialog open={activeAction === "create"} onOpenChange={(open) => setActiveAction(open ? "create" : null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create workspace</DialogTitle>
            <DialogDescription>
              Start a separate workspace for a new company, team, or operating context.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreateWorkspace} className="space-y-4">
            <div>
              <label className="block text-sm font-medium" htmlFor="workspace-create-name">
                Workspace name
              </label>
              <input
                id="workspace-create-name"
                value={workspaceName}
                onChange={(event) => setWorkspaceName(event.target.value)}
                className="mt-2 min-h-11 w-full rounded-2xl border border-input px-3 text-sm outline-none ring-primary/20 focus:ring-4"
                placeholder={suggestedWorkspaceName}
              />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={submitting}>
                {submitting ? "Creating..." : "Create workspace"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={activeAction === "join"} onOpenChange={(open) => setActiveAction(open ? "join" : null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Join workspace</DialogTitle>
            <DialogDescription>
              Enter the workspace ID and invite code you received to join an existing workspace.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleJoinWorkspace} className="space-y-4">
            <div>
              <label className="block text-sm font-medium" htmlFor="join-workspace-id">
                Workspace ID
              </label>
              <input
                id="join-workspace-id"
                value={inviteWorkspaceId}
                onChange={(event) => setInviteWorkspaceId(event.target.value)}
                className="mt-2 min-h-11 w-full rounded-2xl border border-input px-3 text-sm outline-none ring-primary/20 focus:ring-4"
                placeholder="Paste the workspace ID"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium" htmlFor="join-invite-code">
                Invite code
              </label>
              <input
                id="join-invite-code"
                value={inviteCode}
                onChange={(event) => setInviteCode(event.target.value)}
                className="mt-2 min-h-11 w-full rounded-2xl border border-input px-3 text-sm outline-none ring-primary/20 focus:ring-4"
                placeholder="Paste the invite code"
                required
              />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={submitting}>
                {submitting ? "Joining..." : "Join workspace"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
