'use client';

import { useEffect, useState, useCallback } from 'react';
import { Page, BlockStack, Card, Text, Divider } from '@shopify/polaris';
import CountUp from 'react-countup';
import { trpc } from '@/lib/trpc/client';
import { useTrpcAuth } from '@/lib/trpc/provider';
import { TrackerSetupBanner } from './_components/TrackerSetupBanner';
import { UpgradeModal } from './_components/UpgradeModal';
import { BrandLockup } from './_components/GapFinderLogo';
import { BRAND, COLOR, HERO_GRADIENT, RADIUS, SHADOW } from './_components/brand';
import { analytics } from './_components/analytics-client';

// Illustrative gap rows for the hero preview (shown before real data exists).
const PREVIEW_GAPS = [
  { q: 'waterproof jacket', type: 'Missing', meta: '42 searches · 0 results', val: 1240, fg: COLOR.criticalFg, bg: COLOR.criticalBg },
  { q: 'trail running shoes 12', type: 'Wrong match', meta: '28 searches · low CTR', val: 680, fg: COLOR.warningFg, bg: COLOR.warningBg },
  { q: 'merino base layer', type: 'Low interest', meta: '19 searches', val: 310, fg: COLOR.neutralFg, bg: COLOR.neutralBg },
] as const;

const STEPS = [
  { icon: '🧩', title: 'Install tracker', subtitle: 'Auto-injected on install' },
  { icon: '🔄', title: 'Sync catalog', subtitle: 'Products + 90d orders' },
  { icon: '🔍', title: 'Capture searches', subtitle: 'Storefront events in real time' },
  { icon: '🏷️', title: 'Classify gaps', subtitle: 'Missing / Wrong match / Low interest' },
  { icon: '💰', title: 'Recover revenue', subtitle: 'Add products, fix synonyms' },
] as const;

const HOW_IT_WORKS = [
  {
    icon: '🛰️',
    title: 'Storefront tracker',
    body: 'A 2KB script captures every shopper search — what they typed, how many results came back, whether they clicked anything. Auto-installs, no code.',
  },
  {
    icon: '🎯',
    title: 'Catalog matching',
    body: 'Each query is matched against your products with fuzzy + semantic search. Misses become “missing product” opportunities; weak matches become “wrong match” opportunities.',
  },
  {
    icon: '📈',
    title: 'Revenue estimation',
    body: 'Monthly volume × your AOV × your category’s benchmark conversion rate = the revenue at risk for each gap, ranked.',
  },
] as const;

const BEST_PRACTICES = [
  {
    title: 'Shopper searches track automatically',
    body: (
      <>
        Storefront searches are captured in real time and analyzed daily — you don&rsquo;t need to do
        anything. Hit <strong>Refresh data</strong> on the dashboard after a product launch, a price
        drop, or anytime you&rsquo;ve added new SKUs so gap detection re-scores against the new
        catalog. Revenue numbers stabilize once you have <strong>50+ monthly searches</strong> —
        below that, the dashboard shows volume but holds back $ estimates because the sample is too
        small to trust.
      </>
    ),
  },
  {
    title: 'Tackle Missing products first',
    body: (
      <>
        These are searches that returned <strong>zero results</strong> — pure buying intent that hit
        a wall. Each one is a customer who tried to spend money on your store. Adding the right SKU
        (or a category page that catches it) is the single highest-leverage fix in this app: one new
        product can recover the revenue from dozens of failed searches per month.
      </>
    ),
  },
  {
    title: 'Fix Wrong matches with synonyms',
    body: (
      <>
        Shoppers found products but nobody clicked — usually because Shopify surfaced the wrong
        items. Open <strong>Shopify Search &amp; Discovery</strong> and add the suggested synonym
        (e.g. &ldquo;tee shirt&rdquo; → &ldquo;t-shirt&rdquo;). The next time someone searches that
        term, the relevant product ranks first.
      </>
    ),
  },
  {
    title: 'Re-check after every catalog change',
    body: (
      <>
        New collections, seasonal launches, or even renaming products can create fresh search gaps
        overnight. Make a habit of opening {BRAND.name} within 48 hours of any catalog shift — that&rsquo;s
        when the highest-impact gaps surface and the easiest wins are still on the table.
      </>
    ),
  },
  {
    title: 'Watch the trend, not single days',
    body: (
      <>
        A query showing up once is noise. A query showing up <strong>10+ times in the last 30
        days</strong> is signal. The dashboard ranks gaps by occurrence × benchmark conversion rate ×
        your AOV — high-occurrence gaps are always the right place to start.
      </>
    ),
  },
] as const;

const QUICK_NAV = [
  { path: '/dashboard', icon: '📊', title: 'Dashboard', desc: 'Live status, real searches, revenue gaps and fixes.' },
  { path: '/pricing', icon: '💎', title: 'Pricing', desc: 'Compare Free vs Growth — upgrade any time, cancel any time.' },
  { path: '/methodology', icon: '📖', title: 'Methodology', desc: 'How we classify gaps and estimate the revenue at risk.' },
] as const;

export default function HomePage(): JSX.Element {
  const auth = useTrpcAuth();
  // refetchOnWindowFocus: when the merchant returns from Shopify's billing
  // approval screen, the plan may have just been flipped (callback or the
  // app_subscriptions/update webhook) — refetch so the badge updates without a
  // manual reload.
  const planQ = trpc.billing.currentPlan.useQuery(undefined, {
    enabled: auth.ready,
    refetchOnWindowFocus: true,
  });
  const summaryQ = trpc.dashboard.summary.useQuery(undefined, { enabled: auth.ready });
  const trackerQ = trpc.dashboard.trackerStatus.useQuery(undefined, {
    enabled: auth.ready,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const plan = planQ.data?.plan ?? 'FREE';
  const storeName = summaryQ.data?.storeName ?? '';

  useEffect(() => {
    analytics.track('home_viewed', { plan });
  }, [plan]);

  const openUpgrade = (): void => {
    analytics.track('upgrade_cta_clicked', { where: 'home' });
    setUpgradeOpen(true);
  };

  const navigate = useCallback((path: string) => {
    if (typeof window !== 'undefined' && window.shopify?.navigation?.navigate) {
      window.shopify.navigation.navigate(path);
    } else {
      window.location.assign(path);
    }
  }, []);

  return (
    <Page fullWidth>
      <BlockStack gap="500">
        {/* ───────────────────────── HERO ───────────────────────── */}
        <div
          style={{
            position: 'relative',
            overflow: 'hidden',
            background: HERO_GRADIENT,
            borderRadius: RADIUS.xl,
            padding: 'clamp(24px, 4vw, 34px) clamp(20px, 5vw, 40px)',
            color: COLOR.surface,
            boxShadow: SHADOW.hero,
          }}
        >
          <div
            aria-hidden
            style={{
              position: 'absolute',
              right: -80,
              top: -80,
              width: 300,
              height: 300,
              borderRadius: '50%',
              background: 'radial-gradient(circle, rgba(34,211,238,0.38) 0%, transparent 70%)',
              filter: 'blur(20px)',
              pointerEvents: 'none',
            }}
          />
          <div
            style={{
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 32,
            }}
          >
            {/* LEFT */}
            <div style={{ flex: '1 1 460px', minWidth: 280 }}>
              {/* brand lockup */}
              <div style={{ marginBottom: 16 }}>
                <BrandLockup size={30} fontSize={19} tone="onDark" />
              </div>
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: 12,
                  fontWeight: 600,
                  letterSpacing: 0.8,
                  padding: '4px 10px',
                  borderRadius: RADIUS.pill,
                  background: 'rgba(255,255,255,0.14)',
                  border: '1px solid rgba(255,255,255,0.18)',
                  marginBottom: 14,
                }}
              >
                <span
                  className="gf-live-dot"
                  style={{ width: 6, height: 6, borderRadius: '50%', background: COLOR.accent }}
                />
                LIVE · capturing every search
              </div>
              <h1
                style={{
                  // clamp keeps the headline from crowding the preview card at
                  // the ~460px flex-basis breakpoint on narrow admin frames.
                  fontSize: 'clamp(26px, 3.4vw, 33px)',
                  lineHeight: 1.1,
                  fontWeight: 800,
                  margin: 0,
                  marginBottom: 10,
                  letterSpacing: -0.4,
                }}
              >
                Find the searches that{' '}
                <span style={{ color: COLOR.accent }}>cost you sales.</span>
              </h1>
              <p
                style={{
                  fontSize: 16,
                  lineHeight: 1.5,
                  margin: 0,
                  opacity: 0.92,
                  // ~65ch measure — the old 580px ran long on wide screens.
                  maxWidth: '62ch',
                }}
              >
                Every &ldquo;0 results&rdquo; on your storefront is a buyer with intent who walked
                away. {BRAND.name} surfaces every missed query, ranks them by revenue impact, and
                tells you exactly what to fix — usually within minutes of install.
              </p>
              <div style={{ marginTop: 20, display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                <button
                  className="gf-btn gf-btn--onHero"
                  onClick={() => navigate('/dashboard')}
                  style={{
                    background: COLOR.surface,
                    color: COLOR.primaryDeep,
                    fontSize: 14,
                    fontWeight: 700,
                    // 44px min touch target.
                    padding: '12px 18px',
                    borderRadius: RADIUS.md,
                    border: 'none',
                    cursor: 'pointer',
                    boxShadow: SHADOW.md,
                  }}
                >
                  Open dashboard →
                </button>
                {plan === 'FREE' && (
                  <button
                    className="gf-btn gf-btn--ghostHero"
                    onClick={openUpgrade}
                    style={{
                      background: 'rgba(255,255,255,0.12)',
                      color: COLOR.surface,
                      fontSize: 14,
                      fontWeight: 600,
                      padding: '12px 18px',
                      borderRadius: RADIUS.md,
                      border: '1px solid rgba(255,255,255,0.25)',
                      cursor: 'pointer',
                    }}
                  >
                    View plans
                  </button>
                )}
              </div>
              {/* trust strip (replaces the old plain stat boxes) */}
              <div
                style={{
                  marginTop: 18,
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 18,
                  fontSize: 12.5,
                  opacity: 0.85,
                }}
              >
                <span>⚡ Real-time tracker, no code</span>
                <span>⏱️ &lt; 1 min to first sync</span>
                <span>💵 Gaps ranked by revenue</span>
              </div>
            </div>

            {/* RIGHT — dashboard preview card */}
            <div style={{ flex: '0 1 380px', minWidth: 300 }}>
              <div
                style={{
                  background: COLOR.surface,
                  borderRadius: RADIUS.lg,
                  padding: 16,
                  boxShadow: SHADOW.lg,
                  color: COLOR.ink,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    justifyContent: 'space-between',
                    marginBottom: 12,
                  }}
                >
                  <span style={{ fontSize: 13, fontWeight: 700 }}>Top revenue gaps</span>
                  <span style={{ fontSize: 11, color: COLOR.inkSubtle }}>last 30 days</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {PREVIEW_GAPS.map((g, i) => (
                    <div
                      key={g.q}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        padding: '9px 10px',
                        borderRadius: RADIUS.md,
                        background: COLOR.canvas,
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            fontSize: 13,
                            fontWeight: 600,
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                        >
                          “{g.q}”
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 }}>
                          <span
                            style={{
                              fontSize: 10.5,
                              fontWeight: 700,
                              padding: '1px 7px',
                              borderRadius: RADIUS.pill,
                              color: g.fg,
                              background: g.bg,
                            }}
                          >
                            {g.type}
                          </span>
                          <span style={{ fontSize: 11, color: COLOR.inkSubtle }}>{g.meta}</span>
                        </div>
                      </div>
                      <div style={{ fontSize: 14, fontWeight: 800, color: COLOR.primaryDeep }}>
                        <CountUp end={g.val} prefix="$" separator="," duration={1.6} delay={i * 0.15} />
                        <span style={{ fontSize: 11, fontWeight: 600, color: COLOR.inkSubtle }}>/mo</span>
                      </div>
                    </div>
                  ))}
                </div>
                <div
                  style={{
                    marginTop: 12,
                    paddingTop: 10,
                    borderTop: `1px solid ${COLOR.border}`,
                    fontSize: 11.5,
                    color: COLOR.inkSubtle,
                    textAlign: 'center',
                  }}
                >
                  Illustrative — your real gaps appear after first sync
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* WELCOME LINE */}
        {storeName && (
          <Text as="p" tone="subdued">
            Connected to <strong>{storeName}</strong> · Plan: <strong>{plan}</strong>
          </Text>
        )}

        {/* TRACKER SETUP — shown until first search arrives */}
        {summaryQ.data && (summaryQ.data.totalMonthlySearches ?? 0) === 0 && (
          <TrackerSetupBanner
            shopDomain={summaryQ.data.shopDomain}
            embedEnabled={trackerQ.data?.enabled ?? null}
            passwordProtected={trackerQ.data?.passwordProtected ?? null}
          />
        )}

        {/* ───────────── HOW GAPFINDER WORKS — icon stepper ───────────── */}
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">
              How {BRAND.name} works
            </Text>
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 12,
                justifyContent: 'space-between',
              }}
            >
              {STEPS.map((step, i) => (
                <div
                  key={step.title}
                  style={{
                    flex: '1 1 150px',
                    minWidth: 150,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    textAlign: 'center',
                    position: 'relative',
                  }}
                >
                  <div
                    style={{
                      width: 52,
                      height: 52,
                      borderRadius: RADIUS.lg,
                      background: `linear-gradient(135deg, ${COLOR.tint50}, ${COLOR.tint100})`,
                      border: `1px solid ${COLOR.tint200}`,
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 24,
                      marginBottom: 12,
                    }}
                  >
                    {step.icon}
                  </div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: COLOR.primary, marginBottom: 2 }}>
                    STEP {i + 1}
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>{step.title}</div>
                  <div style={{ fontSize: 12.5, color: COLOR.inkMuted, lineHeight: 1.45 }}>
                    {step.subtitle}
                  </div>
                </div>
              ))}
            </div>
          </BlockStack>
        </Card>

        {/* ───────── HOW IT WORKS (icon cards) + BEST PRACTICES ───────── */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
            gap: 16,
            alignItems: 'stretch',
          }}
        >
          <div style={{ display: 'flex' }}>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  How it works
                </Text>
                <Divider />
                <BlockStack gap="300">
                  {HOW_IT_WORKS.map((item) => (
                    <div key={item.title} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                      <div
                        style={{
                          flex: '0 0 auto',
                          width: 38,
                          height: 38,
                          borderRadius: RADIUS.md,
                          background: COLOR.tint50,
                          border: `1px solid ${COLOR.tint200}`,
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 18,
                        }}
                      >
                        {item.icon}
                      </div>
                      <div>
                        <Text as="p" variant="bodyMd" fontWeight="semibold">
                          {item.title}
                        </Text>
                        <Text as="p" variant="bodyMd" tone="subdued">
                          {item.body}
                        </Text>
                      </div>
                    </div>
                  ))}
                </BlockStack>
              </BlockStack>
            </Card>
          </div>

          <div style={{ display: 'flex' }}>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Best practices
                </Text>
                <Divider />
                <BlockStack gap="300">
                  {BEST_PRACTICES.map((bp) => (
                    <div key={bp.title} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                      <span
                        style={{
                          flex: '0 0 auto',
                          width: 22,
                          height: 22,
                          borderRadius: '50%',
                          background: COLOR.primary,
                          color: COLOR.surface,
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 13,
                          fontWeight: 700,
                          marginTop: 1,
                        }}
                      >
                        ✓
                      </span>
                      <div>
                        <Text as="p" variant="bodyMd" fontWeight="semibold">
                          {bp.title}
                        </Text>
                        <Text as="p" variant="bodyMd" tone="subdued">
                          {bp.body}
                        </Text>
                      </div>
                    </div>
                  ))}
                </BlockStack>
              </BlockStack>
            </Card>
          </div>
        </div>

        {/* QUICK NAV CARDS */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
          {QUICK_NAV.map(({ path, icon, title, desc }) => (
            <button
              key={path}
              className="gf-card-btn"
              onClick={() => navigate(path)}
              style={{
                flex: '1 1 280px',
                minWidth: 260,
                background: COLOR.surface,
                border: `1px solid ${COLOR.border}`,
                borderRadius: RADIUS.lg,
                padding: '20px 24px',
                cursor: 'pointer',
                color: COLOR.ink,
                textAlign: 'left',
              }}
            >
              <div style={{ fontSize: 24, marginBottom: 10 }}>{icon}</div>
              <Text as="h3" variant="headingMd">
                {title}
              </Text>
              <Text as="p" tone="subdued" variant="bodyMd">
                {desc}
              </Text>
            </button>
          ))}
        </div>

        <UpgradeModal
          open={upgradeOpen}
          onClose={() => setUpgradeOpen(false)}
          storeId={summaryQ.data?.shopDomain ?? ''}
        />
      </BlockStack>
    </Page>
  );
}
