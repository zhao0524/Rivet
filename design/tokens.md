# Rivet tokens (#37)

CSS custom properties are the machine-usable source. Existing semantic names are preserved. Surface/text, accent, feedback, typography, spacing, radius, elevation, motion, control and layout groups follow the comments in `tokens.css`. Use status text as well as color.

| Token | Value |
|---|---|
| `--rv-bg` | `#0b0d11` |
| `--rv-surface-panel` | `#0f1218` |
| `--rv-surface` | `#11141b` |
| `--rv-surface-raised` | `#161b24` |
| `--rv-surface-hover` | `#1c2230` |
| `--rv-surface-glass` | `rgba(17, 20, 27, 0.88)` |
| `--rv-surface-overlay` | `rgba(11, 13, 17, 0.97)` |
| `--rv-scrim` | `rgba(0, 0, 0, 0.5)` |
| `--rv-backdrop` | `rgba(0, 0, 0, 0.6)` |
| `--rv-border` | `#232a36` |
| `--rv-border-strong` | `#334155` |
| `--rv-text-strong` | `#f8fafc` |
| `--rv-text` | `#e5e7eb` |
| `--rv-text-muted` | `#a3b0c2` |
| `--rv-text-on-accent` | `#ffffff` |
| `--rv-link` | `#60a5fa` |
| `--rv-accent` | `#2563eb` |
| `--rv-accent-hover` | `#1d4ed8` |
| `--rv-accent-border` | `#3b82f6` |
| `--rv-accent-text` | `#93c5fd` |
| `--rv-accent-soft` | `rgba(37, 99, 235, 0.22)` |
| `--rv-focus` | `#60a5fa` |
| `--rv-focus-ring-width` | `2px` |
| `--rv-focus-ring-offset` | `2px` |
| `--rv-warn-bg` | `#1c1917` |
| `--rv-warn-border` | `#292524` |
| `--rv-warn-text` | `#fde68a` |
| `--rv-info-text` | `#bae6fd` |
| `--rv-danger-text` | `#fca5a5` |
| `--rv-status-pass-text` | `#6ee7b7` |
| `--rv-status-pass-solid` | `#10b981` |
| `--rv-status-pass-bg` | `rgba(16, 185, 129, 0.14)` |
| `--rv-status-pass-border` | `rgba(16, 185, 129, 0.4)` |
| `--rv-status-warn-text` | `#fcd34d` |
| `--rv-status-warn-solid` | `#f59e0b` |
| `--rv-status-warn-bg` | `rgba(245, 158, 11, 0.14)` |
| `--rv-status-warn-border` | `rgba(245, 158, 11, 0.4)` |
| `--rv-status-fail-text` | `var(--rv-danger-text)` |
| `--rv-status-fail-solid` | `#ef4444` |
| `--rv-status-fail-bg` | `rgba(239, 68, 68, 0.14)` |
| `--rv-status-fail-border` | `rgba(239, 68, 68, 0.45)` |
| `--rv-status-unknown-text` | `#c4b5fd` |
| `--rv-status-unknown-solid` | `#8b5cf6` |
| `--rv-status-unknown-bg` | `rgba(139, 92, 246, 0.14)` |
| `--rv-status-unknown-border` | `rgba(139, 92, 246, 0.4)` |
| `--rv-status-neutral-text` | `#cbd5e1` |
| `--rv-status-neutral-solid` | `#64748b` |
| `--rv-status-neutral-bg` | `rgba(148, 163, 184, 0.12)` |
| `--rv-status-neutral-border` | `rgba(148, 163, 184, 0.35)` |
| `--rv-trust-synthetic-text` | `var(--rv-warn-text)` |
| `--rv-trust-fallback-text` | `var(--rv-warn-text)` |
| `--rv-trust-saved-text` | `var(--rv-info-text)` |
| `--rv-trust-live-text` | `var(--rv-info-text)` |
| `--rv-font-sans` | `ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif` |
| `--rv-font-mono` | `ui-monospace, SFMono-Regular, Menlo, monospace` |
| `--rv-text-title` | `15px` |
| `--rv-text-heading` | `14px` |
| `--rv-text-section` | `13px` |
| `--rv-text-body` | `13px` |
| `--rv-text-caption` | `12px` |
| `--rv-text-micro` | `11px` |
| `--rv-weight-regular` | `400` |
| `--rv-weight-medium` | `500` |
| `--rv-weight-semibold` | `600` |
| `--rv-weight-bold` | `700` |
| `--rv-leading-tight` | `1.2` |
| `--rv-leading-normal` | `1.45` |
| `--rv-tracking-tight` | `-0.02em` |
| `--rv-tracking-caps` | `0.04em` |
| `--rv-space-1` | `4px` |
| `--rv-space-2` | `8px` |
| `--rv-space-3` | `12px` |
| `--rv-space-4` | `16px` |
| `--rv-space-5` | `24px` |
| `--rv-space-6` | `32px` |
| `--rv-radius-sm` | `6px` |
| `--rv-radius-md` | `8px` |
| `--rv-radius-lg` | `12px` |
| `--rv-radius-pill` | `999px` |
| `--rv-shadow-md` | `0 12px 32px rgba(0, 0, 0, 0.5)` |
| `--rv-shadow-lg` | `0 24px 64px rgba(0, 0, 0, 0.6)` |
| `--rv-blur-glass` | `6px` |
| `--rv-duration-fast` | `120ms` |
| `--rv-duration-base` | `200ms` |
| `--rv-ease-standard` | `ease` |
| `--rv-transition-colors` | `color var(--rv-duration-fast) var(--rv-ease-standard),
    background-color var(--rv-duration-fast) var(--rv-ease-standard),
    border-color var(--rv-duration-fast) var(--rv-ease-standard)` |
| `--rv-z-toolbar` | `5` |
| `--rv-z-scrim` | `25` |
| `--rv-z-drawer` | `30` |
| `--rv-z-overlay` | `40` |
| `--rv-z-menu` | `50` |
| `--rv-z-dialog` | `100` |
| `--rv-control-height` | `30px` |
| `--rv-control-height-sm` | `24px` |
| `--rv-control-padding-x` | `10px` |
| `--rv-control-gap` | `6px` |
| `--rv-disabled-opacity` | `0.55` |
| `--rv-topbar-height` | `48px` |
| `--rv-drawer-width` | `min(360px, 88vw)` |
| `--rv-bp-tablet` | `700px` |
| `--rv-bp-desktop` | `1100px` |

## Base controls

30px minimum desktop control height; content padding and focus ring use control/focus tokens. Dialogs and drawers follow the z-index tokens. Reduced motion sets transition durations to zero. Type roles: title 15px, section/body 13px, caption 12px; monospace only for technical detail.

## Contrast

Core text pairs: --rv-text and --rv-text-muted on --rv-surface; white on --rv-accent; warning/danger/pass/unknown text on --rv-surface. Validate at 4.5:1 minimum and retain visible focus outlines.

Measured from the committed sRGB token values (2026-10-24):

| Pair | Contrast |
|---|---|
| `--rv-text` on `--rv-surface` | 14.88:1 |
| `--rv-text-muted` on `--rv-surface` | 8.38:1 |
| `--rv-status-pass-text` on `--rv-surface` | 12.09:1 |
| `--rv-status-warn-text` on `--rv-surface` | 12.78:1 |
| `--rv-status-unknown-text` on `--rv-surface` | 9.98:1 |
| `white` on `--rv-accent` | 5.17:1 |
