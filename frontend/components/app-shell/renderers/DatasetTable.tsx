"use client";

export type DatasetColumn = { key: string; label: string };
export type DatasetRow = { id: string; cells: Record<string, unknown> };
export type Dataset = {
  kind: "dataset";
  entity?: string;
  query?: string;
  columns: DatasetColumn[];
  rows: DatasetRow[];
};

/** Parse an artifact's content string into a Dataset, or null if it isn't one. */
export function parseDataset(content: string): Dataset | null {
  try {
    const parsed = JSON.parse(content) as Partial<Dataset>;
    if (parsed && parsed.kind === "dataset" && Array.isArray(parsed.columns) && Array.isArray(parsed.rows)) {
      return parsed as Dataset;
    }
  } catch {
    // not JSON / not a dataset
  }
  return null;
}

export function DatasetTable({ dataset }: { dataset: Dataset }) {
  return (
    <div className="overflow-hidden rounded-[1.35rem] border border-border/70 bg-background">
      <div className="flex items-center justify-between gap-3 border-b border-border/60 bg-muted/30 px-5 py-3">
        <span className="text-sm font-semibold text-foreground">
          {dataset.rows.length} {dataset.entity === "person" ? "people" : "records"}
        </span>
        {dataset.query ? (
          <span className="max-w-[60%] truncate text-xs text-muted-foreground">{dataset.query}</span>
        ) : null}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[480px] text-[14px]">
          <thead className="border-b border-border/60 bg-muted/20">
            <tr>
              {dataset.columns.map((column) => (
                <th key={column.key} className="px-4 py-3 text-left text-[12px] font-semibold text-foreground/72">
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {dataset.rows.map((row) => (
              <tr key={row.id} className="border-b border-border/40 last:border-0">
                {dataset.columns.map((column) => {
                  const value = row.cells[column.key];
                  const text = value == null || value === "" ? "—" : String(value);
                  const isUrl = column.key === "url" && text !== "—";
                  return (
                    <td
                      key={column.key}
                      className="px-4 py-3 align-top text-[14px] leading-6 text-foreground/82 break-words"
                    >
                      {isUrl ? (
                        <a href={text} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                          {text}
                        </a>
                      ) : (
                        text
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
