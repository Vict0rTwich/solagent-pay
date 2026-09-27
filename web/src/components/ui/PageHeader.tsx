import type { ReactNode } from "react";

/** Title row for a dashboard page, with optional actions on the right. */
export function PageHeader({
  title,
  description,
  actions,
  note,
}: {
  title: string;
  description: string;
  actions?: ReactNode;
  /** Small muted line under the description, e.g. what data the page shows. */
  note?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        <h1 className="text-[22px] font-semibold leading-tight tracking-[-0.02em] text-ink">{title}</h1>
        <p className="mt-1 text-[13px] text-ink-2">{description}</p>
        {note && <p className="mt-1.5 font-mono text-[11px] text-ink-3">{note}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
