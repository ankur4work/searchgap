'use client';

import { useMemo, useState, useId } from 'react';
import { Card, BlockStack, InlineStack, Text, Select, SkeletonBodyText } from '@shopify/polaris';
import { trpc } from '@/lib/trpc/client';
import { COLOR, RADIUS } from './brand';

/**
 * Searches over time — two series on ONE shared scale.
 *
 * Both series are counts of searches, so they are directly comparable and share
 * an axis. This is deliberately NOT a dual-axis chart: two y-scales let you
 * manufacture any crossing you like and are the single most misleading thing a
 * time-series chart can do.
 *
 * Hand-rolled SVG rather than a charting library: the app ships no chart
 * dependency today, the deploy pipeline is already slow and disk-constrained,
 * and this is one form with one interaction. ~200 lines beats ~500KB.
 *
 * Series colours were validated, not chosen by eye — indigo #4f46e5 vs teal
 * #0d9488 clears the colour-blind separation threshold comfortably
 * (deutan dE 22.1, tritan 11.8, normal 27.1). Orange/red separate even better
 * but are already spoken for by the gap-severity badges, so reusing them here
 * would imply a severity that a volume line doesn't carry.
 */

const SERIES = {
  searches: { label: 'Searches', color: COLOR.primary },
  gaps: { label: 'Gaps', color: '#0d9488' },
} as const;

const RANGES = [
  { label: 'Last 7 days', value: '7' },
  { label: 'Last 30 days', value: '30' },
  { label: 'Last 90 days', value: '90' },
];

/** Plot geometry in viewBox units; the SVG scales fluidly to its container. */
const W = 720;
const H = 240;
const PAD = { top: 16, right: 16, bottom: 28, left: 40 };
const PLOT_W = W - PAD.left - PAD.right;
const PLOT_H = H - PAD.top - PAD.bottom;

interface Point {
  date: string;
  searches: number;
  gaps: number;
}

/** "2026-08-01" -> "Aug 1", without pulling in a date library. */
function shortDate(iso: string): string {
  const [, m, d] = iso.split('-');
  const month = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ][Number(m) - 1];
  return `${month} ${Number(d)}`;
}

/**
 * Round the axis maximum up to a friendly step so gridlines land on readable
 * numbers instead of 37 / 74 / 111.
 */
function niceMax(value: number): number {
  if (value <= 4) return 4;
  const pow = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 2.5, 5, 10]) {
    const candidate = step * pow;
    if (candidate >= value) return candidate;
  }
  return 10 * pow;
}

/**
 * The range is owned by the dashboard page, not by this chart.
 *
 * When the chart kept its own state, switching it to 90 days left the headline
 * cards on their hardcoded 30 — a "last 30 days" total sitting directly above a
 * 90-day plot of the same metric. Lifting it means one window drives both.
 */
export interface SearchTrendChartProps {
  range: string;
  onRangeChange: (range: string) => void;
  /**
   * Polling cadence, driven by the same sync state as the summary cards.
   *
   * The cards polled while a sync settled and this chart did not, so after a
   * burst of searches the cards advanced and the chart stayed on its first
   * render — "20 searches" in the card sitting directly above "17 searches" in
   * the plot, both labelled last 30 days. Two figures for one metric on one
   * screen is the discrepancy the app was rejected for, so the two surfaces now
   * refresh together.
   */
  refetchInterval?: number | false;
}

export function SearchTrendChart({
  range,
  onRangeChange,
  refetchInterval = false,
}: SearchTrendChartProps): JSX.Element {
  const [hover, setHover] = useState<number | null>(null);
  const clipId = useId();

  const trend = trpc.dashboard.searchTrend.useQuery(
    { days: Number(range) },
    { refetchInterval, refetchOnWindowFocus: false },
  );
  const points: Point[] = useMemo(() => trend.data?.series ?? [], [trend.data]);

  const geometry = useMemo(() => {
    if (points.length === 0) return null;
    const max = niceMax(Math.max(...points.map((p) => p.searches), 1));
    // Guard the single-point case: dividing by (n-1) would be a division by zero.
    const stepX = points.length > 1 ? PLOT_W / (points.length - 1) : 0;
    const x = (i: number): number => PAD.left + i * stepX;
    const y = (v: number): number => PAD.top + PLOT_H - (v / max) * PLOT_H;
    const line = (key: 'searches' | 'gaps'): string =>
      points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join(' ');
    const area = `${line('searches')} L${x(points.length - 1).toFixed(1)},${(PAD.top + PLOT_H).toFixed(1)} L${x(0).toFixed(1)},${(PAD.top + PLOT_H).toFixed(1)} Z`;
    return { max, x, y, line, area };
  }, [points]);

  const gridValues = useMemo(() => {
    if (!geometry) return [];
    const { max } = geometry;
    return [0, max / 2, max];
  }, [geometry]);

  // Label roughly five ticks regardless of range, so 90 days doesn't collide.
  const tickEvery = Math.max(1, Math.ceil(points.length / 5));

  const active = hover != null ? points[hover] : null;

  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center" wrap={false}>
          <BlockStack gap="050">
            <Text as="h2" variant="headingMd">
              Searches over time
            </Text>
            <Text as="p" tone="subdued" variant="bodySm">
              {trend.data
                ? `${trend.data.totalSearches.toLocaleString()} searches · ${trend.data.totalGaps.toLocaleString()} of them hit a gap`
                : 'Storefront search volume and how much of it failed'}
            </Text>
          </BlockStack>
          <div style={{ minWidth: 150 }}>
            <Select
              label="Range"
              labelHidden
              options={RANGES}
              value={range}
              onChange={onRangeChange}
            />
          </div>
        </InlineStack>

        {/* Legend is always present for 2 series — identity must never be
            carried by colour alone. */}
        <InlineStack gap="400">
          {(Object.keys(SERIES) as Array<keyof typeof SERIES>).map((k) => (
            <InlineStack key={k} gap="150" blockAlign="center">
              <span
                aria-hidden
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 3,
                  background: SERIES[k].color,
                  display: 'inline-block',
                }}
              />
              <Text as="span" variant="bodySm" tone="subdued">
                {SERIES[k].label}
              </Text>
            </InlineStack>
          ))}
        </InlineStack>

        {trend.isLoading && <SkeletonBodyText lines={6} />}

        {!trend.isLoading && points.length > 0 && geometry && (
          <div style={{ position: 'relative', width: '100%' }}>
            <svg
              viewBox={`0 0 ${W} ${H}`}
              // `height` is a CSS property here, not an SVG presentation
              // attribute: height="auto" is not a valid <length> and Chrome
              // rejects it with "Expected length, 'auto'" on every render. The
              // viewBox plus width:100% already scales the plot fluidly, and
              // aspect-ratio preserves its proportions.
              role="img"
              aria-label={`Searches over the last ${range} days. ${trend.data?.totalSearches ?? 0} searches total, ${trend.data?.totalGaps ?? 0} of which hit a gap.`}
              style={{
                display: 'block',
                width: '100%',
                height: 'auto',
                aspectRatio: `${W} / ${H}`,
                overflow: 'visible',
              }}
              onMouseLeave={() => setHover(null)}
              onMouseMove={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const ratio = ((e.clientX - rect.left) / rect.width) * W;
                const i = Math.round((ratio - PAD.left) / (PLOT_W / Math.max(points.length - 1, 1)));
                setHover(Math.min(points.length - 1, Math.max(0, i)));
              }}
            >
              <defs>
                <linearGradient id={`${clipId}-fill`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={SERIES.searches.color} stopOpacity="0.18" />
                  <stop offset="100%" stopColor={SERIES.searches.color} stopOpacity="0.01" />
                </linearGradient>
              </defs>

              {/* Recessive gridlines — present for reading values, never competing
                  with the data marks. */}
              {gridValues.map((v) => (
                <g key={v}>
                  <line
                    x1={PAD.left}
                    x2={W - PAD.right}
                    y1={geometry.y(v)}
                    y2={geometry.y(v)}
                    stroke={COLOR.border}
                    strokeWidth="1"
                  />
                  <text
                    x={PAD.left - 8}
                    y={geometry.y(v) + 4}
                    textAnchor="end"
                    fontSize="11"
                    fill={COLOR.inkSubtle}
                  >
                    {Math.round(v)}
                  </text>
                </g>
              ))}

              <path d={geometry.area} fill={`url(#${clipId}-fill)`} />
              <path
                d={geometry.line('searches')}
                fill="none"
                stroke={SERIES.searches.color}
                strokeWidth="2"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              <path
                d={geometry.line('gaps')}
                fill="none"
                stroke={SERIES.gaps.color}
                strokeWidth="2"
                strokeLinejoin="round"
                strokeLinecap="round"
              />

              {points.map((p, i) =>
                i % tickEvery === 0 || i === points.length - 1 ? (
                  <text
                    key={p.date}
                    x={geometry.x(i)}
                    y={H - 8}
                    textAnchor={i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'}
                    fontSize="11"
                    fill={COLOR.inkSubtle}
                  >
                    {shortDate(p.date)}
                  </text>
                ) : null,
              )}

              {/* Crosshair + emphasised markers. A 2px surface ring keeps the
                  markers legible where the two lines overlap. */}
              {hover != null && active && (
                <g pointerEvents="none">
                  <line
                    x1={geometry.x(hover)}
                    x2={geometry.x(hover)}
                    y1={PAD.top}
                    y2={PAD.top + PLOT_H}
                    stroke={COLOR.inkDisabled}
                    strokeWidth="1"
                    strokeDasharray="3 3"
                  />
                  {(['searches', 'gaps'] as const).map((k) => (
                    <circle
                      key={k}
                      cx={geometry.x(hover)}
                      cy={geometry.y(active[k])}
                      r="4.5"
                      fill={SERIES[k].color}
                      stroke={COLOR.surface}
                      strokeWidth="2"
                    />
                  ))}
                </g>
              )}
            </svg>

            {hover != null && active && (
              <div
                role="status"
                style={{
                  position: 'absolute',
                  top: 0,
                  left: `${(geometry.x(hover) / W) * 100}%`,
                  transform:
                    hover > points.length / 2 ? 'translate(-105%, 0)' : 'translate(5%, 0)',
                  background: COLOR.surface,
                  border: `1px solid ${COLOR.border}`,
                  borderRadius: RADIUS.sm,
                  boxShadow: '0 2px 4px rgba(30,27,75,0.06), 0 8px 20px rgba(30,27,75,0.10)',
                  padding: '8px 10px',
                  pointerEvents: 'none',
                  whiteSpace: 'nowrap',
                  fontSize: 12,
                }}
              >
                <div style={{ fontWeight: 600, marginBottom: 4, color: COLOR.ink }}>
                  {shortDate(active.date)}
                </div>
                {(['searches', 'gaps'] as const).map((k) => (
                  <div
                    key={k}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, color: COLOR.inkMuted }}
                  >
                    <span
                      aria-hidden
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: 2,
                        background: SERIES[k].color,
                        display: 'inline-block',
                      }}
                    />
                    {SERIES[k].label}: <strong style={{ color: COLOR.ink }}>{active[k]}</strong>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {!trend.isLoading && points.every((p) => p.searches === 0) && (
          <Text as="p" tone="subdued" variant="bodySm">
            No storefront searches captured yet. Once shoppers search, this fills in
            automatically — no refresh needed.
          </Text>
        )}
      </BlockStack>
    </Card>
  );
}
