import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

/** A Settings section: icon, title and description, an optional badge in the top-right corner, then its controls. */
export function SettingsCard({
  icon: Icon,
  title,
  description,
  badge,
  children,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  badge?: ReactNode;
  children: ReactNode;
}) {
  const id = `${title.replace(/\W+/g, "-").toLowerCase()}-heading`;
  return (
    <section aria-labelledby={id} className="card p-5">
      <div className="flex items-start gap-3">
        <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-lg border border-accent-line bg-accent-soft text-accent-ink">
          <Icon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id={id} className="text-sm font-medium text-ink">
            {title}
          </h2>
          <p className="mt-0.5 text-[13px] text-ink-2">{description}</p>
        </div>
        {badge && <div className="shrink-0">{badge}</div>}
      </div>
      <div className="mt-5">{children}</div>
    </section>
  );
}
