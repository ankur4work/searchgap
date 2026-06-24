/**
 * SearchGap brand mark: a magnifying glass whose lens ring has a deliberate
 * GAP at the top (with a lime accent dot) — visualizing the "find the gap"
 * idea. Color + accent are props so it works on the emerald hero (white mark)
 * and on light surfaces (emerald mark).
 */
export function SearchGapLogo({
  size = 28,
  color = '#ffffff',
  accent = '#a3e635',
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
      {/* the "gap" — accent dot at one broken edge */}
      <circle cx="18" cy="4.5" r="1.7" fill={accent} />
    </svg>
  );
}
