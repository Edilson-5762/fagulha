const NAVY = "#0a0e17";
const BLUE = "#4f8cff";
const WHITE = "#f4f6fb";

type BrandMarkProps = {
  /** Rendered pixel size (the SVG is a 512-unit square scaled to fit). */
  size: number;
  /** Draw the dark rounded-square plate behind the artwork. */
  background?: boolean;
};

/**
 * The Fagulha mark: two rounded "devices" linked by a bidirectional arrow.
 *
 * Written as an inline SVG built only from rect / circle / path so the same
 * artwork drives the favicon, the installable PWA icons and the share image,
 * and so Satori (`next/og`) can rasterize it without a browser.
 */
export function BrandMark({ size, background = false }: BrandMarkProps) {
  return (
    <div style={{ display: "flex", width: size, height: size }}>
      <svg width={size} height={size} viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
        {background ? <rect x="0" y="0" width="512" height="512" rx="112" fill={NAVY} /> : null}

        {/* back device */}
        <rect x="250" y="150" width="170" height="230" rx="34" fill={BLUE} opacity="0.4" />

        {/* front device */}
        <rect x="92" y="132" width="170" height="230" rx="34" fill={BLUE} />
        <circle cx="177" cy="168" r="9" fill={NAVY} />
        <rect x="150" y="322" width="54" height="12" rx="6" fill={NAVY} />

        {/* bidirectional arrow across the gap */}
        <path
          d="M196 232 L300 232 M286 214 L312 232 L286 250"
          stroke={WHITE}
          strokeWidth="22"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
        <path
          d="M316 286 L212 286 M226 268 L200 286 L226 304"
          stroke={WHITE}
          strokeWidth="22"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </svg>
    </div>
  );
}
