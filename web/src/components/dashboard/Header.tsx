"use client";

import { ChevronRight, Menu, Search, X, Zap } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

import { SearchShortcut } from "@/components/ui/SearchInput";
import { useDashboard } from "@/lib/dashboard-store";

import { DataSourceBadge } from "./DataSourceBadge";
import { toggleConsole } from "./DevLogDrawer";
import { DateRangeMenu } from "./DateRangeMenu";
import { POS_PATH, sectionFor } from "./nav";
import { NetworkStatus } from "./NetworkStatus";
import { SessionBadge } from "./SessionBadge";
import { WalletButton } from "./WalletButton";

function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
  );
}

/**
 * On the overview the header carries search and the date range, which scope that page.
 * Sub-pages have their own filter bars, so the header shows where you are instead.
 */
export function Header({ onOpenMenu }: { onOpenMenu: () => void }) {
  const pathname = usePathname();
  const section = sectionFor(pathname);

  // "/" (outside text fields) or ⌘K / Ctrl+K (anywhere) jumps to the page's search field.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const slash = event.key === "/" && !event.metaKey && !event.ctrlKey && !isTypingTarget(event.target);
      const commandK = event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey;
      if (!slash && !commandK) return;
      const search = document.querySelector<HTMLInputElement>("[data-page-search]");
      if (search) {
        event.preventDefault();
        search.focus();
        search.select();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-canvas">
      <div className="flex h-14 items-center gap-2 px-4 sm:gap-2.5 sm:px-6 lg:px-8">
        <button
          type="button"
          onClick={onOpenMenu}
          aria-label="Open menu"
          className="grid size-8 shrink-0 place-items-center rounded-md border border-line-strong text-ink-2 transition-colors hover:bg-raised hover:text-ink lg:hidden"
        >
          <Menu className="size-4" />
        </button>

        {section ? (
          <nav aria-label="Breadcrumb" className="min-w-0 flex-1">
            <ol className="flex items-center gap-1.5 text-[13px]">
              <li className="hidden sm:block">
                <Link href="/dashboard" className="text-ink-3 transition-colors hover:text-ink">
                  Dashboard
                </Link>
              </li>
              <li aria-hidden className="hidden text-ink-3 sm:block">
                <ChevronRight className="size-3.5" />
              </li>
              <li className="flex min-w-0 items-center gap-2 font-medium text-ink" aria-current="page">
                <section.icon className="size-4 shrink-0 text-accent-ink" aria-hidden />
                <span className="truncate">{section.label}</span>
              </li>
            </ol>
          </nav>
        ) : (
          <OverviewSearch />
        )}

        <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
          <Link
            href={POS_PATH}
            aria-label="PoS mode: open the fullscreen register"
            title="Open the fullscreen register for in-person sales"
            className="btn-primary inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[13px]"
          >
            <Zap className="size-3.5" fill="currentColor" strokeWidth={1.5} aria-hidden />
            <span className="hidden sm:inline">PoS mode</span>
          </Link>
          <DataSourceBadge />
          <NetworkStatus display="hidden md:inline-flex" onClick={() => toggleConsole()} />
          {!section && <DateRangeMenu />}
          <SessionBadge />
          <WalletButton collapseLabel compact />
        </div>
      </div>
    </header>
  );
}

function OverviewSearch() {
  const { query, setQuery } = useDashboard();
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <form role="search" onSubmit={(e) => e.preventDefault()} className="relative min-w-0 max-w-md flex-1">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
      <input
        ref={inputRef}
        data-page-search
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setQuery("");
            e.currentTarget.blur();
          }
        }}
        placeholder="Search payments, clients, wallets…"
        aria-label="Search payments by client, wallet, invoice or memo"
        aria-keyshortcuts="Control+K Meta+K /"
        className="h-8 w-full text-ellipsis rounded-lg border border-line bg-panel pl-9 pr-16 text-[13px] text-ink outline-none transition-colors placeholder:text-ink-3 hover:border-line-strong focus:border-accent focus-visible:outline-none [&::-webkit-search-cancel-button]:hidden"
      />
      {query ? (
        <button
          type="button"
          onClick={() => {
            setQuery("");
            inputRef.current?.focus();
          }}
          aria-label="Clear search"
          className="absolute right-1.5 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-md text-ink-3 hover:bg-raised hover:text-ink"
        >
          <X className="size-3.5" />
        </button>
      ) : (
        <SearchShortcut className="right-1.5" />
      )}
    </form>
  );
}
