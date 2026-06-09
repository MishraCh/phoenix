import { AlertCircle, Database, Search, RefreshCw, LogIn } from "lucide-react";
import type { ExpertPayloadStatus, ExpertSearchMetadata } from "../../../../services/command";
import { Button } from "../../../ui/button";

interface MissingDataStateProps {
  status: ExpertPayloadStatus;
  searchMetadata?: ExpertSearchMetadata;
  title?: string;
}

export function MissingDataState({ status, searchMetadata, title = "Data Unavailable" }: MissingDataStateProps) {
  if (status === "ready" || status === "success" || status === "partial") return null;

  const getStatusContent = () => {
    switch (status) {
      case "not_found":
        return {
          icon: <Search className="w-5 h-5 text-zinc-400" />,
          heading: "Record Not Found",
          description: "We couldn't find a matching record in the connected system.",
        };
      case "missing_context":
        return {
          icon: <AlertCircle className="w-5 h-5 text-amber-500" />,
          heading: "Context Required",
          description: "Gideon needs more specific context (like a selected CRM record or web search result) to run this capability accurately.",
        };
      case "connection_missing":
        return {
          icon: <Database className="w-5 h-5 text-amber-500" />,
          heading: "Integration Required",
          description: "This capability requires a connected integration that is currently missing.",
        };
      case "permission_missing":
        return {
          icon: <AlertCircle className="w-5 h-5 text-red-500" />,
          heading: "Permission Denied",
          description: "Gideon lacks the necessary permissions to read this data.",
        };
      default:
        return {
          icon: <AlertCircle className="w-5 h-5 text-red-500" />,
          heading: "Error Retrieving Data",
          description: "An unexpected error occurred while trying to fetch the required information.",
        };
    }
  };

  const content = getStatusContent();

  return (
    <div className="overflow-hidden rounded-2xl border border-border/60 bg-background shadow-[0_2px_12px_-4px_rgba(0,0,0,0.05)] ring-1 ring-border/20 flex flex-col">
      <div className="flex items-center justify-between border-b border-border/50 bg-muted/20 px-4 py-3">
        <div className="flex items-center gap-2">
          {content.icon}
          <h3 className="text-[13px] font-semibold text-foreground">{title}</h3>
        </div>
        <span className="text-[10px] font-medium text-muted-foreground bg-muted/40 px-2 py-0.5 rounded-full uppercase tracking-wider">
          {status.replace("_", " ")}
        </span>
      </div>

      <div className="p-4 flex flex-col gap-3">
        <p className="text-[13px] leading-6 text-muted-foreground">{content.description}</p>

        {searchMetadata && (
          <div className="bg-muted/10 rounded-lg p-3 text-[12px] flex flex-col gap-2 border border-border/40">
            {searchMetadata.query && (
              <div className="flex gap-2">
                <span className="font-medium text-muted-foreground w-16 shrink-0">Searched:</span>
                <span className="text-foreground font-mono">"{searchMetadata.query}"</span>
              </div>
            )}
            {searchMetadata.sourceUsed && (
              <div className="flex gap-2">
                <span className="font-medium text-muted-foreground w-16 shrink-0">Source:</span>
                <span className="text-foreground">{searchMetadata.sourceUsed}</span>
              </div>
            )}
            {searchMetadata.missingData && searchMetadata.missingData.length > 0 && (
              <div className="flex gap-2">
                <span className="font-medium text-muted-foreground w-16 shrink-0">Missing:</span>
                <div className="flex flex-col gap-1">
                  {searchMetadata.missingData.map((item, idx) => (
                    <span key={idx} className="text-destructive font-medium">
                      {item}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="mt-2 flex items-center gap-2">
          {status === "not_found" && (
            <Button variant="outline" size="sm" className="h-8 text-[12px]">
              <RefreshCw className="w-3 h-3 mr-1.5" />
              Try refining your search
            </Button>
          )}
          {status === "connection_missing" && (
            <Button variant="default" size="sm" className="h-8 text-[12px]">
              <LogIn className="w-3 h-3 mr-1.5" />
              Connect Integration
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
