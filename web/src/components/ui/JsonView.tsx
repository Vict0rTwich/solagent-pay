import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

// Strings (and whether they're keys), literals, numbers: enough to color pretty-printed JSON.
const TOKEN = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;

/**
 * Pretty-printed JSON for the dark console (the palette doesn't follow the theme). Mostly brightness, not hue:
 * dim keys and punctuation, bright values, and two muted tints so numbers and literals stand apart.
 */
export function JsonView({ value, className }: { value: unknown; className?: string }) {
  const text = JSON.stringify(value, null, 2) ?? "undefined";
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(TOKEN)) {
    const [token, string, colon, literal] = match;
    const index = match.index;
    if (index > last) parts.push(text.slice(last, index));
    const key = `${index}`;
    if (string && colon) {
      parts.push(
        <span key={key} className="text-console-ink-2">
          {string}
        </span>,
        colon,
      );
    } else if (string) {
      parts.push(
        <span key={key} className="text-console-ink">
          {string}
        </span>,
      );
    } else if (literal) {
      parts.push(
        <span key={key} className="text-[#8fb4d8]">
          {literal}
        </span>,
      );
    } else {
      parts.push(
        <span key={key} className="text-[#d8b26e]">
          {token}
        </span>,
      );
    }
    last = index + token.length;
  }
  parts.push(text.slice(last));
  return <pre className={cn("overflow-x-auto whitespace-pre text-console-ink-3", className)}>{parts}</pre>;
}
