'use client';

import { useCallback, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import '../../styles/thinking.css';

export type TreeStatus = 'pending' | 'running' | 'done' | 'warning' | 'failed';

/** One row of the tree. A node with children is a folder. */
export interface TreeNode {
  id: string;
  label: string;
  /** Muted text after the label on the same row. */
  detail?: string;
  /** Row mark. Default: folder for nodes with children, file otherwise. */
  icon?: IconName;
  status?: TreeStatus;
  /** Replaces the screen-reader text for the status (e.g. "Must fix"). */
  statusText?: string;
  children?: TreeNode[];
  /** Whether pressing it selects it. Default: leaves yes, folders no. */
  selectable?: boolean;
  testId?: string;
}

const STATUS_TEXT: Record<TreeStatus, string> = {
  pending: 'Not started',
  running: 'In progress',
  done: 'Done',
  warning: 'Needs a look',
  failed: "Didn't work",
};

export interface TreeViewProps {
  nodes: readonly TreeNode[];
  /** Accessible name of the tree. */
  label: string;
  /** Controlled open folder ids. */
  open?: readonly string[];
  defaultOpen?: readonly string[];
  onOpenChange?: (open: string[]) => void;
  /** Controlled selected id (null = nothing selected). */
  selectedId?: string | null;
  defaultSelectedId?: string | null;
  onSelect?: (node: TreeNode) => void;
  /** Pixels per level. Default 22. */
  indent?: number;
  /** A hairline down each open folder. Default true. */
  guides?: boolean;
  testId?: string;
}

interface Flat {
  node: TreeNode;
  depth: number;
  parentId: string | null;
}

const isFolder = (n: TreeNode) => Boolean(n.children && n.children.length > 0);
const canSelect = (n: TreeNode) => n.selectable ?? !isFolder(n);

/**
 * A tree of folders and rows (adapted from Bencho's Tree view): one row height, an indent per
 * level, a hairline guide down each open folder, folders that slide open under themselves.
 * Keyboard: Up/Down move, Right opens (then steps in), Left closes (then steps out), Home/End,
 * Enter or Space selects a row or toggles a folder.
 */
export function TreeView({
  nodes,
  label,
  open: openProp,
  defaultOpen = [],
  onOpenChange,
  selectedId: selectedProp,
  defaultSelectedId = null,
  onSelect,
  indent = 22,
  guides = true,
  testId,
}: TreeViewProps) {
  const [openState, setOpenState] = useState<string[]>(() => [...defaultOpen]);
  const [selectedState, setSelectedState] = useState<string | null>(defaultSelectedId);
  const openIds = openProp ?? openState;
  const selectedId = selectedProp !== undefined ? selectedProp : selectedState;
  const openSet = useMemo(() => new Set(openIds), [openIds]);
  const [focusId, setFocusId] = useState<string | null>(null);
  const itemRefs = useRef(new Map<string, HTMLLIElement>());
  const prefix = useId();

  // Rows a keyboard can reach: everything not inside a closed folder.
  const visible = useMemo(() => {
    const out: Flat[] = [];
    const walk = (list: readonly TreeNode[], depth: number, parentId: string | null) => {
      for (const node of list) {
        out.push({ node, depth, parentId });
        if (isFolder(node) && openSet.has(node.id)) walk(node.children!, depth + 1, node.id);
      }
    };
    walk(nodes, 0, null);
    return out;
  }, [nodes, openSet]);

  const setOpen = useCallback(
    (next: string[]) => {
      if (openProp === undefined) setOpenState(next);
      onOpenChange?.(next);
    },
    [openProp, onOpenChange],
  );

  const toggle = (id: string, to?: boolean) => {
    const isOpen = openSet.has(id);
    const want = to ?? !isOpen;
    if (want === isOpen) return;
    setOpen(want ? [...openIds, id] : openIds.filter((x) => x !== id));
  };

  const select = (node: TreeNode) => {
    if (!canSelect(node)) return;
    if (selectedProp === undefined) setSelectedState(node.id);
    onSelect?.(node);
  };

  const focus = (id: string) => {
    setFocusId(id);
    itemRefs.current.get(id)?.focus();
  };

  // The one row in the tab order: the focused row, else the selected one, else the first.
  const tabId =
    (focusId && visible.some((f) => f.node.id === focusId) && focusId) ||
    (selectedId && visible.some((f) => f.node.id === selectedId) && selectedId) ||
    visible[0]?.node.id;

  function onKeyDown(e: KeyboardEvent<HTMLUListElement>) {
    const current = visible.findIndex((f) => f.node.id === (focusId ?? tabId));
    if (current < 0) return;
    const { node, parentId } = visible[current]!;
    let handled = true;
    switch (e.key) {
      case 'ArrowDown':
        if (current < visible.length - 1) focus(visible[current + 1]!.node.id);
        break;
      case 'ArrowUp':
        if (current > 0) focus(visible[current - 1]!.node.id);
        break;
      case 'Home':
        focus(visible[0]!.node.id);
        break;
      case 'End':
        focus(visible[visible.length - 1]!.node.id);
        break;
      case 'ArrowRight':
        if (isFolder(node)) {
          if (!openSet.has(node.id)) toggle(node.id, true);
          else focus(node.children![0]!.id);
        }
        break;
      case 'ArrowLeft':
        if (isFolder(node) && openSet.has(node.id)) toggle(node.id, false);
        else if (parentId) focus(parentId);
        break;
      case 'Enter':
      case ' ':
        if (canSelect(node)) select(node);
        else if (isFolder(node)) toggle(node.id);
        break;
      default:
        handled = false;
    }
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  }

  const renderNode = (node: TreeNode, depth: number, index: number): ReactNode => {
    const folder = isFolder(node);
    const isOpen = folder && openSet.has(node.id);
    const selectable = canSelect(node);
    const selected = selectable && selectedId === node.id;
    const mark: IconName = node.icon ?? (folder ? (isOpen ? 'folderOpen' : 'folder') : 'file');
    const shownMark: IconName = mark === 'folder' && isOpen ? 'folderOpen' : mark;
    return (
      <li
        key={node.id}
        id={`${prefix}-${node.id}`}
        ref={(el) => {
          if (el) itemRefs.current.set(node.id, el);
          else itemRefs.current.delete(node.id);
        }}
        role="treeitem"
        className="tv-item"
        aria-level={depth + 1}
        aria-expanded={folder ? isOpen : undefined}
        aria-selected={selectable ? selected : undefined}
        tabIndex={tabId === node.id ? 0 : -1}
        onFocus={(e) => {
          if (e.target === e.currentTarget) setFocusId(node.id);
        }}
        style={{ '--i': index } as CSSProperties}
        data-testid={node.testId}
      >
        <div
          className="tv-row"
          style={{ marginLeft: depth * indent }}
          onClick={() => {
            focus(node.id);
            if (selectable) select(node);
            else if (folder) toggle(node.id);
          }}
        >
          <span className="tv-chev" data-open={isOpen || undefined} aria-hidden="true">
            {folder ? <Icon name="chevronRight" size={14} /> : null}
          </span>
          <span className="tv-mark" aria-hidden="true">
            <Icon name={shownMark} size={16} />
          </span>
          <span className="tv-name">{node.label}</span>
          {node.detail ? <span className="tv-detail">{node.detail}</span> : null}
          {node.status ? (
            <span className="tv-status" data-status={node.status}>
              <StatusMark status={node.status} />
              <span className="ui-sr-only">{node.statusText ?? STATUS_TEXT[node.status]}</span>
            </span>
          ) : null}
        </div>
        {folder ? (
          <div className="tv-kids" data-open={isOpen || undefined}>
            <ul
              role="group"
              className="tv-group"
              data-guides={guides || undefined}
              style={{ '--tv-x': `${depth * indent + 14}px` } as CSSProperties}
            >
              {node.children!.map((child, j) => renderNode(child, depth + 1, j))}
            </ul>
          </div>
        ) : null}
      </li>
    );
  };

  return (
    <ul role="tree" aria-label={label} className="tv" onKeyDown={onKeyDown} data-testid={testId}>
      {nodes.map((n, i) => renderNode(n, 0, i))}
    </ul>
  );
}

function StatusMark({ status }: { status: TreeStatus }) {
  if (status === 'running') return <Icon name="spinner" size={14} className="tv-spin" />;
  if (status === 'done') return <Icon name="check" size={14} />;
  if (status === 'pending') return <Icon name="minus" size={14} />;
  if (status === 'failed') return <Icon name="close" size={14} />;
  return <Icon name="alert" size={14} />;
}
