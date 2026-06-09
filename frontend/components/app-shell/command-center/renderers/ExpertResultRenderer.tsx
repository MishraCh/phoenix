import type { CommandExpertResult } from "@/services/command";
import { CardShell, ConfidenceMeter } from "./CardShell";
import { MissingDataState } from "./MissingDataState";

export function ExpertResultRenderer({ result }: { result: CommandExpertResult }) {
  const payload = result.payload as any;

  if (payload?.status && payload.status !== "ready" && payload.status !== "success" && payload.status !== "partial") {
    return (
      <MissingDataState
        status={payload.status}
        searchMetadata={payload.searchMetadata}
        title="Analysis Unavailable"
      />
    );
  }

  const source = payload?.searchMetadata?.sourceUsed ?? null;
  const sections = Array.isArray(payload?.sections) ? payload.sections : [];
  const table = payload?.table;
  const checklist = Array.isArray(payload?.checklist) ? payload.checklist : [];
  const timeline = Array.isArray(payload?.timeline) ? payload.timeline : [];
  const risks = Array.isArray(payload?.risks) ? payload.risks : [];
  const recommendations = Array.isArray(payload?.recommendations) ? payload.recommendations : [];
  const nextActions = Array.isArray(payload?.nextActions) ? payload.nextActions : [];

  return (
    <CardShell type={result.expertType} sourceLabel={source}>
      <div className="space-y-5">
        {payload?.title && (
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">
              Structured result
            </p>
            <h3 className="mt-1 text-[17px] font-semibold tracking-tight text-foreground">
              {payload.title}
            </h3>
          </div>
        )}

        {payload?.summary && (
          <p className="text-[15px] leading-7 text-foreground/90">
            {payload.summary}
          </p>
        )}

        {payload?.score && (
          <div className="rounded-xl border border-border/60 bg-muted/25 p-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  {payload.score.label}
                </p>
                {payload.score.explanation ? (
                  <p className="mt-1 text-[13px] leading-6 text-muted-foreground">
                    {payload.score.explanation}
                  </p>
                ) : null}
              </div>
              <div className="text-right">
                <p className="text-3xl font-semibold tabular-nums text-foreground">
                  {Math.round(payload.score.value)}
                </p>
                <p className="text-[11px] text-muted-foreground">/ 100</p>
              </div>
            </div>
          </div>
        )}

        {payload?.details && (
          <div className="whitespace-pre-wrap text-[14px] leading-6 text-foreground/86">
            {payload.details}
          </div>
        )}

        {sections.length ? (
          <div className="grid gap-3 md:grid-cols-2">
            {sections.map((section: any, index: number) => (
              <section key={`${section.title}-${index}`} className="rounded-xl border border-border/55 p-4">
                <h4 className="text-[13px] font-semibold text-foreground">{section.title}</h4>
                {section.body ? (
                  <p className="mt-2 text-[13px] leading-6 text-foreground/82">{section.body}</p>
                ) : null}
                {Array.isArray(section.bullets) && section.bullets.length ? (
                  <ul className="mt-2 list-disc space-y-1 pl-4 text-[13px] leading-6 text-foreground/80">
                    {section.bullets.map((item: string) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                ) : null}
              </section>
            ))}
          </div>
        ) : null}

        {table?.columns?.length && Array.isArray(table.rows) ? (
          <div className="overflow-x-auto rounded-xl border border-border/55">
            <table className="w-full min-w-[520px] text-left text-[13px]">
              <thead className="bg-muted/40 text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
                <tr>
                  {table.columns.map((column: string) => (
                    <th key={column} className="px-3 py-2 font-semibold">{column}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((row: string[], index: number) => (
                  <tr key={index} className="border-t border-border/45">
                    {row.map((cell, cellIndex) => (
                      <td key={`${index}-${cellIndex}`} className="px-3 py-2 align-top leading-6 text-foreground/82">
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {timeline.length ? (
          <div className="space-y-2">
            <h4 className="text-[12px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Timeline
            </h4>
            {timeline.map((item: any) => (
              <div key={`${item.label}-${item.detail}`} className="border-l-2 border-primary/25 pl-3">
                <p className="text-[13px] font-semibold text-foreground">{item.label}</p>
                <p className="text-[13px] leading-6 text-muted-foreground">{item.detail}</p>
              </div>
            ))}
          </div>
        ) : null}

        {[checklist, risks, recommendations, nextActions].some((list) => list.length) ? (
          <div className="grid gap-3 md:grid-cols-2">
            {[
              ["Checklist", checklist],
              ["Risks", risks],
              ["Recommendations", recommendations],
              ["Next actions", nextActions],
            ].map(([title, list]) =>
              Array.isArray(list) && list.length ? (
                <section key={title as string} className="rounded-xl bg-muted/25 p-4">
                  <h4 className="text-[12px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    {title as string}
                  </h4>
                  <ul className="mt-2 list-disc space-y-1 pl-4 text-[13px] leading-6 text-foreground/82">
                    {list.map((item: string) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </section>
              ) : null,
            )}
          </div>
        ) : null}

        <ConfidenceMeter confidence={payload?.confidence} />
      </div>
    </CardShell>
  );
}
