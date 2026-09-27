"use client";

import { X } from "lucide-react";
import { useEffect, useRef, type ReactNode, type RefObject } from "react";

/**
 * Native <dialog> modal: focus trap, Escape and the inert background come from the browser.
 * `initialFocus` gets focus on open instead of the first focusable element. `wide` fits two columns (a form beside
 * its preview).
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  initialFocus,
  wide = false,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  initialFocus?: RefObject<HTMLElement | null>;
  wide?: boolean;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = `${title.replace(/\W+/g, "-").toLowerCase()}-title`;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      initialFocus?.current?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open, initialFocus]);

  return (
    <dialog
      ref={dialogRef}
      className={wide ? "sheet sheet-wide" : "sheet"}
      // React passes a nested dialog's close event up the component tree (the DOM event doesn't bubble), so a
      // modal opened from inside this one would otherwise close both. The event also arrives a task after
      // close(): if the dialog was reopened in between, it's stale.
      onClose={(event) => {
        if (event.target === event.currentTarget && !event.currentTarget.open) onClose();
      }}
      aria-labelledby={titleId}
    >
      <div className="p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 id={titleId} className="text-base font-semibold tracking-[-0.01em] text-ink">
              {title}
            </h2>
            {description && <div className="mt-1 text-[13px] text-ink-2">{description}</div>}
          </div>
          <div className="-mr-1.5 -mt-1 flex shrink-0 items-center gap-1">
            <kbd className="kbd hidden sm:inline-flex" aria-hidden>
              esc
            </kbd>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              aria-keyshortcuts="Escape"
              className="grid size-8 place-items-center rounded-md text-ink-3 transition-colors hover:bg-raised hover:text-ink"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>
        {open && children}
      </div>
    </dialog>
  );
}
