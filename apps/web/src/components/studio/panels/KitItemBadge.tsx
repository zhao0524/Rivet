import styles from "./BuildGuide.module.css";

export const UNMODELED_KIT_LABEL = "unmodeled kit item";

/** Box icon for loose kit items that have no 3D model (wires, cells, adapters). */
export function KitItemIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      className={styles.kitIcon}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
      data-icon="kit-item"
    >
      <path d="M8 1.5 14 4.5v7L8 14.5 2 11.5v-7z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M2 4.5 8 7.5l6-3M8 7.5v7" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  );
}

/** Icon plus the words "unmodeled kit item": the part is real and in the BOM, just not drawn in 3D. */
export function KitItemBadge({ testId }: { testId?: string }) {
  return (
    <span
      className={styles.kitBadge}
      data-testid={testId}
      data-unmodeled="true"
      title="In the BOM and the assembly steps, but not drawn in the 3D view"
    >
      <KitItemIcon size={12} />
      {UNMODELED_KIT_LABEL}
    </span>
  );
}
