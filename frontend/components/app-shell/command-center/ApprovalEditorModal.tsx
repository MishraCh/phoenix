"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/ToastProvider";
import { editApproval, fetchApproval } from "@/services/approvals";

type ApprovalEditorModalProps = {
  approvalId: string | null;
  onClose: () => void;
  onSaved: () => void;
};

export function ApprovalEditorModal({ approvalId, onClose, onSaved }: ApprovalEditorModalProps) {
  const { user } = useAuth();
  const { pushToast } = useToast();
  
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  
  // The full approval data
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [approval, setApproval] = useState<any>(null);
  
  // Form state
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [to, setTo] = useState("");
  // Generic CRM field editor: edits input.properties / input.updates (or flat
  // primitive input fields) for hubspot_create, hubspot_update, notes, tasks…
  const [crmFields, setCrmFields] = useState<Array<{ key: string; value: string }>>([]);
  const [crmContainer, setCrmContainer] = useState<string | null>(null);

  useEffect(() => {
    if (!approvalId || !user) {
      setApproval(null);
      return;
    }

    let mounted = true;
    setLoading(true);
    
    user.getIdToken().then((token: string) => {
      fetchApproval(token, approvalId)
        .then((data) => {
          if (mounted) {
            if (data.status !== "pending" && data.status !== "edited") {
              setLoading(false);
              pushToast({ title: "Cannot edit", description: "This approval has already been executed or rejected.", tone: "error" });
              onClose();
              return;
            }
            setApproval(data);
            const isEmailType = data.type === "email_send" || 
                                data.proposedAction?.toolName === "gmail.prepareSendApproval" || 
                                data.proposedAction?.toolName === "gmail.sendApproved";
            // Initialize form state if it's an email
            if (isEmailType) {
               const input = data.proposedAction?.input as Record<string, any> || {};
               setSubject(input.subject || "");
               setBody(input.body || "");
               setTo(Array.isArray(input.to) ? input.to.join(", ") : (input.to || ""));
            } else {
               const input = (data.proposedAction?.input as Record<string, any>) || {};
               const containerKey = ["properties", "updates"].find(
                 (k) => input[k] && typeof input[k] === "object" && !Array.isArray(input[k]),
               );
               const source: Record<string, any> = containerKey ? input[containerKey] : input;
               const editable = Object.entries(source).filter(
                 ([k, v]) =>
                   (typeof v === "string" || typeof v === "number" || typeof v === "boolean") &&
                   !["module", "recordId", "objectType", "actionType"].includes(k),
               );
               setCrmContainer(containerKey ?? null);
               setCrmFields(editable.map(([k, v]) => ({ key: k, value: String(v) })));
            }
            setLoading(false);
          }
        })
        .catch((err) => {
          if (mounted) {
            setLoading(false);
            pushToast({ title: "Failed to load approval", description: err.message, tone: "error" });
            onClose();
          }
        });
    });

    return () => { mounted = false; };
  }, [approvalId, user, onClose, pushToast]);

  async function handleSave() {
    if (!user || !approvalId || !approval) return;
    
    setSaving(true);
    try {
      const token = await user.getIdToken();
      
      const patch = {
        proposedAction: {
          input: {
            ...approval.proposedAction.input,
          }
        },
        preview: {
          ...approval.preview
        }
      };

      const isEmailType = approval.type === "email_send" || 
                          approval.proposedAction?.toolName === "gmail.prepareSendApproval" || 
                          approval.proposedAction?.toolName === "gmail.sendApproved";

      if (isEmailType) {
        const toArray = to.split(",").map(t => t.trim()).filter(Boolean);
        patch.proposedAction.input.subject = subject;
        patch.proposedAction.input.body = body;
        patch.proposedAction.input.to = toArray;

        patch.preview.subject = subject;
        patch.preview.body = body;
        patch.preview.to = toArray;
      } else if (crmFields.length) {
        const edited = Object.fromEntries(crmFields.map((f) => [f.key, f.value]));
        if (crmContainer) {
          patch.proposedAction.input[crmContainer] = {
            ...(approval.proposedAction?.input?.[crmContainer] ?? {}),
            ...edited,
          };
          if (patch.preview[crmContainer] && typeof patch.preview[crmContainer] === "object") {
            patch.preview[crmContainer] = { ...patch.preview[crmContainer], ...edited };
          }
        } else {
          Object.assign(patch.proposedAction.input, edited);
          for (const f of crmFields) {
            if (f.key in patch.preview) patch.preview[f.key] = f.value;
          }
        }
      }

      await editApproval(token, approvalId, patch);
      
      pushToast({ title: "Approval updated", description: "Your changes have been saved." });
      onSaved();
      onClose();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      pushToast({ title: "Failed to save", description: message, tone: "error" });
    } finally {
      setSaving(false);
    }
  }

  const isEmail = approval?.type === "email_send" || 
                  approval?.proposedAction?.toolName === "gmail.prepareSendApproval" || 
                  approval?.proposedAction?.toolName === "gmail.sendApproved";

  return (
    <Dialog open={!!approvalId} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit Action Payload</DialogTitle>
          <DialogDescription>
            Modify the details before executing this action.
          </DialogDescription>
        </DialogHeader>
        
        <div className="py-2">
          {loading ? (
            <div className="flex h-40 items-center justify-center">
              <Loader2 className="size-6 animate-spin text-primary/50" />
            </div>
          ) : !approval ? (
            <p className="text-center text-sm text-muted-foreground">Approval not found.</p>
          ) : isEmail ? (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm font-semibold text-foreground">To</label>
                <input 
                  type="text" 
                  value={to} 
                  onChange={(e) => setTo(e.target.value)}
                  className="w-full rounded-xl border border-border/50 bg-background px-3 py-2 text-sm outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/50" 
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-semibold text-foreground">Subject</label>
                <input 
                  type="text" 
                  value={subject} 
                  onChange={(e) => setSubject(e.target.value)}
                  className="w-full rounded-xl border border-border/50 bg-background px-3 py-2 text-sm outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/50" 
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-semibold text-foreground">Message Body</label>
                <textarea 
                  value={body} 
                  onChange={(e) => setBody(e.target.value)}
                  rows={10}
                  className="w-full resize-y rounded-xl border border-border/50 bg-background px-3 py-2 text-sm outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/50" 
                />
              </div>
            </div>
          ) : crmFields.length ? (
            <div className="space-y-4 max-h-[55vh] overflow-y-auto pr-1">
              {crmFields.map((field, idx) => (
                <div key={field.key} className="space-y-1.5">
                  <label className="text-sm font-semibold text-foreground capitalize">{field.key.replace(/_/g, " ")}</label>
                  <input
                    type="text"
                    value={field.value}
                    onChange={(e) =>
                      setCrmFields((prev) => prev.map((f, i) => (i === idx ? { ...f, value: e.target.value } : f)))
                    }
                    className="w-full rounded-xl border border-border/50 bg-background px-3 py-2 text-sm outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/50"
                  />
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-border bg-secondary/30 p-4">
              <p className="text-sm text-muted-foreground">This action has no editable fields. You can approve it as-is or reject it.</p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={loading || saving || !approval || (!isEmail && crmFields.length === 0)}>
            {saving && <Loader2 className="mr-2 size-4 animate-spin" />}
            Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
