'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  /** One line under the title. */
  description?: ReactNode;
  children?: ReactNode;
  /** Footer actions. Put the one primary CTA last. */
  footer?: ReactNode;
  /** `drawer` slides in from the right edge; `wide` fits content-heavy modals. */
  variant?: 'modal' | 'wide' | 'drawer';
  testId?: string;
  /** CSS selector of the control to focus on open (default: first control in the body). */
  initialFocus?: string;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Accessible modal or drawer: portal to `document.body`, Escape and backdrop close,
 * focus moves into the body on open, Tab is trapped inside, focus returns to the opener on close.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  variant = 'modal',
  testId,
  initialFocus,
}: ModalProps) {
  const titleId = useId();
  const descId = useId();
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
    const requested = initialFocus ? panel?.querySelector<HTMLElement>(initialFocus) : null;
    (requested ?? panel?.querySelector<HTMLElement>(`.ui-modal__body :is(${FOCUSABLE})`) ?? panel)?.focus();

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
  }, [open, mounted, initialFocus]);

  if (!open || !mounted) return null;

  const drawer = variant === 'drawer';
  return createPortal(
    <div
      className={drawer ? 'ui-scrim ui-scrim--drawer' : 'ui-scrim'}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        data-testid={testId}
        className={drawer ? 'ui-drawer' : variant === 'wide' ? 'ui-modal ui-modal--wide' : 'ui-modal'}
      >
        <div className="ui-modal__head">
          <div>
            <h2 id={titleId} className="ui-h2">
              {title}
            </h2>
            {description ? (
              <p id={descId} className="ui-muted ui-small" style={{ margin: '6px 0 0' }}>
                {description}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            className="ui-btn ui-btn--ghost ui-btn--icon ui-btn--sm"
            aria-label="Close"
            data-testid={testId ? `${testId}-close` : undefined}
            onClick={onClose}
          >
            <Icon name="close" />
          </button>
        </div>
        <div className="ui-modal__body">{children}</div>
        {footer ? <div className="ui-modal__foot">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}
