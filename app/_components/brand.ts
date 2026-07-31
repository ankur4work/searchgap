/**
 * GapFinder design tokens.
 *
 * Single source of truth for brand colour, elevation and radius across the
 * embedded app and the public marketing/legal pages. Before this existed the
 * palette was ~30 hard-coded hexes spread over six files, which is why the
 * SearchGap → GapFinder rebrand touched every page. Add new surfaces here, not
 * inline.
 *
 * Palette rationale: indigo/violet primary deliberately avoids Shopify admin's
 * own green so the app reads as its own product, and it keeps red / amber /
 * slate free to mean *only* gap severity (Missing / Wrong match / Low interest).
 * Cyan is the accent — decorative use only (dots, pulses, the logo gap), never
 * as text on a light surface, where it would fail WCAG AA.
 *
 * Contrast (vs #fff): primary 6.3:1, primaryDeep 8.2:1, primaryInk 12.6:1 — all
 * pass AA for body text.
 */

export const BRAND = {
  /** Product name, as shown to merchants. */
  name: 'GapFinder',
  /** Split for the two-tone wordmark: `Gap` + `Finder`. */
  nameLead: 'Gap',
  nameTail: 'Finder',
  tagline: 'Turn Shopify search gaps into revenue.',
} as const;

export const COLOR = {
  /** Primary action / brand fill. */
  primary: '#4f46e5',
  /** Deeper primary for text on light surfaces and hovers. */
  primaryDeep: '#4338ca',
  /** Darkest brand ink — headings, gradient terminus. */
  primaryInk: '#312e81',
  /** Near-black indigo, ends the hero gradient. */
  primaryVoid: '#1e1b4b',

  /** Accent — decorative only. Never text on light. */
  accent: '#22d3ee',
  accentStrong: '#06b6d4',

  /** Tinted surfaces, lightest → strongest. */
  tint50: '#eef2ff',
  tint100: '#e0e7ff',
  tint200: '#c7d2fe',

  /** Neutrals, aligned with Polaris' own greys so the app doesn't clash. */
  ink: '#202223',
  inkMuted: '#5a6168',
  inkSubtle: '#6d7175',
  inkDisabled: '#9ba3af',
  border: '#e1e3e5',
  borderSubtle: '#eef1f3',
  surface: '#ffffff',
  canvas: '#f6f8fa',

  /** Semantic — gap severity and billing states. Independent of brand hue. */
  criticalFg: '#dc2626',
  criticalBg: '#fee2e2',
  warningFg: '#b45309',
  warningBg: '#fef3c7',
  neutralFg: '#475569',
  neutralBg: '#e2e8f0',
  successFg: '#166534',
  successBg: '#dcfce7',
  success: '#16a34a',
} as const;

/** Hero / header band gradient. Used by the app home and the public pages. */
export const HERO_GRADIENT =
  `radial-gradient(120% 140% at 0% 0%, ${COLOR.primary} 0%, ${COLOR.primaryDeep} 35%, ${COLOR.primaryVoid} 100%)`;

/**
 * Layered elevation. Each step keeps the same light direction (top-down) and
 * pairs a tight contact shadow with a wider ambient one, which reads far softer
 * than the single large blur the old pages used.
 */
export const SHADOW = {
  sm: '0 1px 2px rgba(30,27,75,0.06), 0 2px 6px rgba(30,27,75,0.06)',
  md: '0 2px 4px rgba(30,27,75,0.06), 0 8px 20px rgba(30,27,75,0.10)',
  lg: '0 4px 8px rgba(30,27,75,0.08), 0 16px 36px rgba(30,27,75,0.16)',
  /** Brand-tinted glow for the hero block. */
  hero: '0 6px 14px rgba(79,70,229,0.16), 0 18px 40px rgba(49,46,129,0.26)',
} as const;

/** Radii. Nested radius = outer − padding, so these step in ~4px increments. */
export const RADIUS = {
  sm: 8,
  md: 10,
  lg: 14,
  xl: 18,
  pill: 999,
} as const;

/** Standard easing/duration for hover + enter transitions (150–250ms, ease-out). */
export const MOTION = {
  fast: '150ms cubic-bezier(0.22, 1, 0.36, 1)',
  base: '220ms cubic-bezier(0.22, 1, 0.36, 1)',
} as const;
