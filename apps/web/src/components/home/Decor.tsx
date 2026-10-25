/**
 * Decorative frosted-glass hardware renders (transparent WebP in /public/decor).
 * Purely ornamental: hidden from assistive tech, never focusable, never covering text.
 */

export type DecorName =
  | 'gear'
  | 'bolt'
  | 'bolt-tee'
  | 'nut-hex'
  | 'nut-cube'
  | 'spring'
  | 'crystal'
  | 'wrench-a'
  | 'wrench-b'
  | 'washer';

/** Intrinsic sizes of the exported files, so the browser reserves space before they load. */
const SIZES: Record<DecorName, [number, number]> = {
  gear: [714, 720],
  bolt: [647, 490],
  'bolt-tee': [644, 720],
  'nut-hex': [720, 698],
  'nut-cube': [608, 600],
  spring: [695, 561],
  crystal: [685, 720],
  'wrench-a': [258, 720],
  'wrench-b': [376, 720],
  washer: [720, 539],
};

export interface DecorItem {
  name: DecorName;
  /** Modifier for position and size in marketing.css, e.g. `hero-gear`. */
  spot: string;
}

export function Decor({ items, eager = false }: { items: readonly DecorItem[]; eager?: boolean }) {
  return (
    <div className="mk-decor" aria-hidden="true">
      {items.map(({ name, spot }) => {
        const [width, height] = SIZES[name];
        return (
          // eslint-disable-next-line @next/next/no-img-element -- static ornaments; next/image adds nothing here
          <img
            key={spot}
            src={`/decor/${name}.webp`}
            alt=""
            width={width}
            height={height}
            loading={eager ? 'eager' : 'lazy'}
            decoding="async"
            draggable={false}
            className={`mk-decor__item mk-decor--${spot}`}
          />
        );
      })}
    </div>
  );
}
