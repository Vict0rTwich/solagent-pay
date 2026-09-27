import { Zap } from "lucide-react";
import Link from "next/link";

/** Logo and name. Links to the dashboard, except where `href` is null (the payer-facing checkout page). */
export function BrandMark({ onNavigate, href = "/dashboard" }: { onNavigate?: () => void; href?: string | null }) {
  const content = (
    <>
      <span aria-hidden className="grid size-6 place-items-center rounded-md bg-accent text-accent-fg">
        <Zap className="size-3.5" fill="currentColor" strokeWidth={1.5} />
      </span>
      <span className="text-[15px] font-semibold tracking-[-0.02em] text-ink">
        SolAgent<span className="font-normal text-ink-3"> Pay</span>
      </span>
    </>
  );

  if (href === null) return <span className="flex items-center gap-2">{content}</span>;
  return (
    <Link href={href} onClick={onNavigate} className="flex items-center gap-2 rounded-md">
      {content}
    </Link>
  );
}
