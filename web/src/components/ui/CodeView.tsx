import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

// Comments, strings, keywords, numbers, calls and object keys: enough to read a TypeScript snippet at a glance.
const TOKEN =
  /(\/\/[^\n]*)|("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`)|\b(import|from|export|const|let|async|await|return|new|default|function|type)\b|\b(\d+(?:\.\d+)?)\b|([A-Za-z_$][\w$]*)(?=\s*\()|([A-Za-z_$][\w$]*)(?=\s*:(?!:))/g;

const CLASSES = ["text-console-ink-3 italic", "text-emerald-300/85", "text-blue-300", "text-[#d8b26e]", "text-[#8fb4d8]", "text-console-ink-2"] as const;

/** A syntax-highlighted TypeScript snippet on the dark console surface, in both themes like a terminal. */
export function CodeView({ code, className }: { code: string; className?: string }) {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of code.matchAll(TOKEN)) {
    const index = match.index;
    if (index > last) parts.push(code.slice(last, index));
    const group = match.slice(1).findIndex((value) => value !== undefined);
    parts.push(
      <span key={index} className={CLASSES[group]}>
        {match[0]}
      </span>,
    );
    last = index + match[0].length;
  }
  parts.push(code.slice(last));
  return (
    <pre className={cn("overflow-x-auto rounded-lg border border-console-line bg-console p-4 font-mono text-[12px] leading-[1.65] text-console-ink", className)}>
      <code>{parts}</code>
    </pre>
  );
}
