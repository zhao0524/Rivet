'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  /** Wider layout for content-heavy dialogs (intake, exports). */
  wide?: boolean;
  testId?: string;
  /** CSS selector of the control to focus on open (default: first control in the body). */
  initialFocus?: string;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Accessible modal dialog: portal to `document.body`, Escape and backdrop close,
 * focus moves to the first control in the body on open, Tab is trapped inside, focus returns to the opener on close.
 */
export function Dialog({ open, onClose, title, children, wide = false, testId, initialFocus }: DialogProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  // Portals cannot be server-rendered; mount first so SSR and the first client render agree.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open || !mounted) return;
    const opener = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    // Requested control, else first control in the body (not the header close button), else the dialog.
    const requested = initialFocus ? panel?.querySelector<HTMLElement>(initialFocus) : null;
    (requested ?? panel?.querySelector<HTMLElement>(`.rv-dialog__body :is(${FOCUSABLE})`) ?? panel)?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab' || !panel) return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      opener?.focus?.();
    };
  }, [open, mounted]);

  if (!open || !mounted) return null;

  return createPortal(
    <div
      className="rv-dialog-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        data-testid={testId}
        className={wide ? 'rv-dialog rv-dialog--wide' : 'rv-dialog'}
      >
        <div className="rv-dialog__header">
          <h2 id={titleId} className="rv-dialog__title">
            {title}
          </h2>
          <button
            type="button"
            className="rv-btn rv-btn--ghost"
            aria-label="Close"
            data-testid={testId ? `${testId}-close` : undefined}
            onClick={onClose}
          >
            ✕
          </button>
        </div>
        <div className="rv-dialog__body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
