"use client";

import { Search, X } from "lucide-react";
import { useRef } from "react";

import { useModKey } from "@/hooks/use-mod-key";
import { cn } from "@/lib/cn";

/** Shared look for search fields: a recessed well with a shortcut hint. */
export const searchFieldClass =
  "h-9 w-full text-ellipsis rounded-lg border border-line bg-canvas pl-9 pr-14 text-[13px] text-ink outline-none transition-colors placeholder:text-ink-3 hover:border-line-strong focus:border-accent focus-visible:outline-none [&::-webkit-search-cancel-button]:hidden";

/** "⌘ K" on Apple keyboards, "Ctrl K" elsewhere: the shortcut that focuses the page's search. Position it with `className`. */
export function SearchShortcut({ className }: { className?: string }) {
  const mod = useModKey();
  return (
    <kbd className={cn("kbd pointer-events-none absolute top-1/2 hidden -translate-y-1/2 sm:inline-flex", className)} aria-hidden>
      {mod}
      <span>K</span>
    </kbd>
  );
}

/**
 * Search field for a page's table. `data-page-search` lets the "/" and ⌘K shortcuts in the header focus it.
 */
export function SearchInput({
  value,
  onChange,
  placeholder,
  label,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  /** Accessible name; the placeholder alone disappears once someone types. */
  label: string;
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <form role="search" onSubmit={(e) => e.preventDefault()} className={cn("relative min-w-0", className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
      <input
        ref={inputRef}
        data-page-search
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && value) {
            e.stopPropagation();
            onChange("");
          }
        }}
        placeholder={placeholder}
        aria-label={label}
        aria-keyshortcuts="Control+K Meta+K /"
        className={searchFieldClass}
      />
      {value ? (
        <button
          type="button"
          onClick={() => {
            onChange("");
            inputRef.current?.focus();
          }}
          aria-label="Clear search"
          className="absolute right-2 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-md text-ink-3 hover:bg-raised hover:text-ink"
        >
          <X className="size-3.5" />
        </button>
      ) : (
        <SearchShortcut className="right-2" />
      )}
    </form>
  );
}
