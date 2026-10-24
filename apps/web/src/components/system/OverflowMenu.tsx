'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Icon } from './Icon';

export interface OverflowItem {
  id: string;
  label: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
  danger?: boolean;
  testId?: string;
}

export interface OverflowMenuProps {
  items: readonly OverflowItem[];
  /** Accessible name of the trigger, e.g. "More actions". */
  label?: string;
  testId?: string;
  /** Visible trigger content; defaults to a ••• icon button. */
  trigger?: ReactNode;
}

/**
 * Secondary actions behind one button (WAI-ARIA menu button pattern): Enter/Space/ArrowDown
 * open it, arrows move between items, Escape or an outside click closes it and returns focus.
 */
export function OverflowMenu({ items, label = 'More actions', testId, trigger }: OverflowMenuProps) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const entries = () =>
    Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([aria-disabled="true"])') ?? []);

  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) buttonRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    entries()[0]?.focus();
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const list = entries();
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
    <div ref={rootRef} className="ui-menu-wrap">
      <button
        ref={buttonRef}
        type="button"
        className={trigger ? 'ui-btn ui-btn--ghost' : 'ui-btn ui-btn--ghost ui-btn--icon'}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={trigger ? undefined : label}
        data-testid={testId}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        {trigger ?? <Icon name="more" />}
      </button>
      {open ? (
        <div ref={listRef} id={menuId} role="menu" aria-label={label} className="ui-menu" onKeyDown={onKeyDown}>
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              tabIndex={-1}
              aria-disabled={item.disabled || undefined}
              data-testid={item.testId}
              className={item.danger ? 'ui-menu__item ui-menu__item--danger' : 'ui-menu__item'}
              onClick={() => {
                if (item.disabled) return;
                close();
                item.onSelect();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
