import { BRAND, COLOR } from './brand';

/**
 * GapFinder brand mark: a magnifying glass whose lens ring has a deliberate
 * GAP at the top, marked with an accent dot — the gap *is* the logo.
 *
 * Colour and accent are props so the mark works on the indigo hero (white) and
 * on light surfaces (indigo). Geometry is tuned to stay legible at 16px, so
 * don't add detail here — the favicon uses the same paths.
 */
export function GapFinderLogo({
  size = 28,
  color = COLOR.surface,
  accent = COLOR.accent,
  strokeWidth = 2.6,
}: {
  size?: number;
  color?: string;
  accent?: string;
  strokeWidth?: number;
}): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      style={{ display: 'block' }}
    >
      {/* lens ring with a gap at the top (drawn the long way round) */}
      <path
        d="M18 4.5 A 9 9 0 1 1 12 4.5"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
      />
      {/* handle */}
      <line
        x1="21.4"
        y1="19.4"
        x2="27.5"
        y2="27.5"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
      />
      {/* the "gap" — accent dot at the broken edge */}
      <circle cx="18" cy="4.5" r="1.7" fill={accent} />
    </svg>
  );
}

/**
 * Logo + wordmark lockup. Used on the app hero and both public pages, which
 * previously each re-implemented the same flex row and two-tone `<span>`s.
 *
 * `tone="onDark"` for the hero band, `"onLight"` for white surfaces.
 */
export function BrandLockup({
  size = 28,
  fontSize = 19,
  tone = 'onDark',
}: {
  size?: number;
  fontSize?: number;
  tone?: 'onDark' | 'onLight';
}): JSX.Element {
  const onDark = tone === 'onDark';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
      <GapFinderLogo
        size={size}
        color={onDark ? COLOR.surface : COLOR.primaryDeep}
        accent={onDark ? COLOR.accent : COLOR.accentStrong}
      />
      <span
        style={{
          fontSize,
          fontWeight: 800,
          letterSpacing: -0.3,
          color: onDark ? COLOR.surface : COLOR.primaryInk,
        }}
      >
        {BRAND.nameLead}
        <span style={{ color: onDark ? COLOR.accent : COLOR.primary }}>{BRAND.nameTail}</span>
      </span>
    </div>
  );
}
