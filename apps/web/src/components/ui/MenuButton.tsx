'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

export type MenuEntry =
  | {
      kind?: 'item';
      id: string;
      label: ReactNode;
      onSelect: () => void;
      /** Present for toggles: renders as `menuitemcheckbox` and keeps the menu open. */
      checked?: boolean;
      disabled?: boolean;
      testId?: string;
    }
  | { kind: 'separator'; id: string };

export interface MenuButtonProps {
  label: ReactNode;
  entries: readonly MenuEntry[];
  testId?: string;
  /** Accessible name when `label` is not plain text. */
  ariaLabel?: string;
  align?: 'start' | 'end';
  buttonClassName?: string;
}

/**
 * Disclosure menu (WAI-ARIA menu button pattern): Enter/Space/ArrowDown open it,
 * arrows move between items, Escape or an outside click closes it and returns focus.
 */
export function MenuButton({
  label,
  entries,
  testId,
  ariaLabel,
  align = 'end',
  buttonClassName = 'rv-btn',
}: MenuButtonProps) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const items = () =>
    Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]:not(:disabled)') ?? []);

  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) buttonRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    items()[0]?.focus();
    const onPointerDown = (e: PointerEvent | MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  const onListKeyDown = (e: KeyboardEvent<HTMLUListElement>) => {
    const list = items();
    const index = list.indexOf(document.activeElement as HTMLButtonElement);
    const move = (next: number) => {
      e.preventDefault();
      list[(next + list.length) % list.length]?.focus();
    };
    if (e.key === 'ArrowDown') move(index + 1);
    else if (e.key === 'ArrowUp') move(index - 1);
    else if (e.key === 'Home') move(0);
    else if (e.key === 'End') move(list.length - 1);
    else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'Tab') close(false);
  };

  return (
    <div ref={rootRef} className="rv-menu">
      <button
        ref={buttonRef}
        type="button"
        className={buttonClassName}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={ariaLabel}
        data-testid={testId}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        {label}
        <span aria-hidden="true">▾</span>
      </button>
      {open ? (
        <ul
          ref={listRef}
          id={menuId}
          role="menu"
          className={align === 'start' ? 'rv-menu__list rv-menu__list--start' : 'rv-menu__list'}
          onKeyDown={onListKeyDown}
        >
          {entries.map((entry) =>
            entry.kind === 'separator' ? (
              <li key={entry.id} role="separator" className="rv-menu__separator" />
            ) : (
              <li key={entry.id} role="none">
                <button
                  type="button"
                  role={entry.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
                  aria-checked={entry.checked}
                  disabled={entry.disabled}
                  tabIndex={-1}
                  data-testid={entry.testId}
                  className="rv-menu__item"
                  onClick={() => {
                    entry.onSelect();
                    if (entry.checked === undefined) close();
                  }}
                >
                  <span>{entry.label}</span>
                  {entry.checked ? (
                    <span className="rv-menu__check" aria-hidden="true">
                      ✓
                    </span>
                  ) : null}
                </button>
              </li>
            ),
          )}
        </ul>
      ) : null}
    </div>
  );
}
