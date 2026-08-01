'use client';

import { useCallback, useState } from 'react';
import { Page, BlockStack, Card, Text, Button, Banner, Modal } from '@shopify/polaris';
import { trpc } from '@/lib/trpc/client';
import { useTrpcAuth } from '@/lib/trpc/provider';
import { UpgradeModal } from '../_components/UpgradeModal';
import { analytics } from '../_components/analytics-client';
import { redirectTop } from '../_components/redirect-top';
import { BRAND, COLOR, RADIUS, SHADOW } from '../_components/brand';

/**
 * Plan comparison. Deliberately FEATURE-ONLY — no amounts.
 *
 * Under Shopify App Pricing the price lives in the dev dashboard and the app
 * owner can change it at any time without a deploy. Any figure printed here
 * would be a stale copy that contradicts Shopify's own plan page and the actual
 * charge. The only money this page ever shows is the merchant's real, live
 * subscription price, read back from Shopify.
 */
const FREE_FEATURES = [
  { included: true, label: 'Real-time storefront tracker (auto-installs, no code)' },
  { included: true, label: 'Top 5 highest-revenue search gaps visible' },
  { included: true, label: 'Three-way gap classification (missing / wrong match / low interest)' },
  { included: true, label: 'Weekly snapshot of search performance' },
  { included: false, label: 'Full gap list — every missed search, not just the top 5' },
  { included: false, label: 'Dollar revenue estimate on each gap' },
  { included: false, label: 'Weekly digest email' },
  { included: false, label: 'Keyword fix suggestions with matched product' },
  { included: false, label: 'Priority email support' },
];

const GROWTH_FEATURES = [
  'Everything in Free, plus:',
  'Every gap shown — no top-5 cap',
  'Dollar revenue estimate per gap (with low/high band)',
  'Weekly digest email summarizing new gaps & fixes applied',
  'Keyword fix suggestions with matched product title',
  'Priority email support',
];

/** Format the live subscription price using the currency Shopify reported. */
function formatLivePrice(price: { amount: string; currencyCode: string; interval: string }): string {
  const amount = Number(price.amount);
  const formatted = Number.isFinite(amount)
    ? new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: price.currencyCode,
        // Shopify returns "9.00"; drop cents when there are none.
        minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
      }).format(amount)
    : `${price.amount} ${price.currencyCode}`;
  const period = price.interval === 'ANNUAL' ? 'year' : 'month';
  return `${formatted} / ${period}`;
}

export default function PricingPage(): JSX.Element {
  const auth = useTrpcAuth();
  const planQ = trpc.billing.currentPlan.useQuery(undefined, {
    enabled: auth.ready,
    // The merchant may be returning from Shopify's plan page having just
    // changed plan — refetch so the card reflects it without a manual reload.
    refetchOnWindowFocus: true,
  });
  const summaryQ = trpc.dashboard.summary.useQuery(undefined, { enabled: auth.ready });
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const plan = planQ.data?.plan ?? 'FREE';
  const livePrice = planQ.data?.price ?? null;

  // Cancellation finishes on Shopify's plan page — appSubscriptionCancel is
  // Partner-API-only for managed subscriptions and needs org credentials this
  // session doesn't have, so the app cannot cancel on the merchant's behalf.
  const cancelUrl = trpc.billing.planSelectionUrl.useQuery(undefined, { enabled: cancelOpen });

  const confirmCancel = (): void => {
    analytics.track('cancel_cta_clicked', { where: 'pricing' });
    const url = cancelUrl.data?.url;
    if (!url) return;
    redirectTop(url);
  };

  const openUpgrade = (): void => {
    analytics.track('upgrade_cta_clicked', { where: 'pricing' });
    setUpgradeOpen(true);
  };

  const goBack = useCallback(() => {
    if (typeof window !== 'undefined' && window.shopify?.navigation?.navigate) {
      window.shopify.navigation.navigate('/');
    } else {
      window.location.assign('/');
    }
  }, []);

  return (
    <Page title="Pricing" backAction={{ content: 'Home', onAction: goBack }}>
      <BlockStack gap="500">
        <Card>
          <BlockStack gap="200">
            <Text as="h1" variant="headingXl">
              Recover lost revenue. Pay nothing while you decide.
            </Text>
            <Text as="p" tone="subdued">
              Every Shopify store loses revenue to searches that return nothing. {BRAND.name} finds
              those moments and tells you exactly what to fix. Start on Free — upgrade only when
              you see real gaps worth recovering.
            </Text>
          </BlockStack>
        </Card>

        {plan === 'GROWTH' && (
          <Banner tone="success" title="You&rsquo;re on Growth">
            <p>
              Thanks for upgrading. You have access to everything below.
              {livePrice ? ` Your plan renews at ${formatLivePrice(livePrice)}.` : ''}
            </p>
          </Banner>
        )}

        {planQ.data?.stale && (
          <Banner tone="warning" title="Showing your last known plan">
            <p>
              We couldn&rsquo;t reach Shopify to confirm your subscription just now. Plan details
              may be out of date — reload in a moment.
            </p>
          </Banner>
        )}

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
          {/* FREE */}
          <div
            style={{
              flex: '1 1 320px',
              minWidth: 280,
              border: plan === 'FREE' ? `2px solid ${COLOR.primary}` : `1px solid ${COLOR.border}`,
              borderRadius: RADIUS.lg,
              padding: '28px 30px',
              background: COLOR.surface,
              position: 'relative',
            }}
          >
            {plan === 'FREE' && (
              <div
                style={{
                  position: 'absolute',
                  top: -10,
                  left: 16,
                  background: COLOR.primary,
                  color: COLOR.surface,
                  fontSize: 11,
                  fontWeight: 700,
                  padding: '2px 10px',
                  borderRadius: RADIUS.pill,
                  letterSpacing: 0.6,
                }}
              >
                YOUR PLAN
              </div>
            )}
            <Text as="h2" variant="headingLg">
              Free
            </Text>
            <Text as="p" tone="subdued" variant="bodySm">
              Get a feel for your search gaps before paying anything.
            </Text>
            <div style={{ marginTop: 14, marginBottom: 18 }}>
              <span style={{ fontSize: 28, fontWeight: 800, color: COLOR.ink }}>Free forever</span>
            </div>
            <ul style={{ padding: 0, listStyle: 'none', marginTop: 8 }}>
              {FREE_FEATURES.map((f) => (
                <li
                  key={f.label}
                  style={{
                    fontSize: 14,
                    padding: '7px 0',
                    color: f.included ? COLOR.ink : COLOR.inkDisabled,
                    display: 'flex',
                    gap: 10,
                    lineHeight: 1.4,
                  }}
                >
                  <span
                    style={{
                      color: f.included ? COLOR.success : COLOR.inkDisabled,
                      fontWeight: 700,
                      flexShrink: 0,
                    }}
                  >
                    {f.included ? '✓' : '✕'}
                  </span>
                  <span>{f.label}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* GROWTH */}
          <div
            style={{
              flex: '1 1 320px',
              minWidth: 280,
              border:
                plan === 'GROWTH' ? `2px solid ${COLOR.success}` : `2px solid ${COLOR.primary}`,
              borderRadius: RADIUS.lg,
              padding: '28px 30px',
              background:
                plan === 'GROWTH'
                  ? COLOR.surface
                  : `linear-gradient(180deg, ${COLOR.tint50} 0%, ${COLOR.surface} 60%)`,
              position: 'relative',
              boxShadow: plan === 'GROWTH' ? 'none' : SHADOW.md,
            }}
          >
            <div
              style={{
                position: 'absolute',
                top: -10,
                left: 16,
                background: plan === 'GROWTH' ? COLOR.success : COLOR.primary,
                color: COLOR.surface,
                fontSize: 11,
                fontWeight: 700,
                padding: '2px 10px',
                borderRadius: RADIUS.pill,
                letterSpacing: 0.6,
              }}
            >
              {plan === 'GROWTH' ? 'YOUR PLAN' : 'MOST POPULAR'}
            </div>
            <Text as="h2" variant="headingLg">
              Growth
            </Text>
            <Text as="p" tone="subdued" variant="bodySm">
              For merchants ready to act on every gap and recover the revenue.
            </Text>
            <div style={{ marginTop: 14, marginBottom: 18 }}>
              {/* Only ever the merchant's REAL price, straight from Shopify.
                  On Free there is no subscription to read, so we point at the
                  plan page rather than guess at an amount. */}
              {plan === 'GROWTH' && livePrice ? (
                <span style={{ fontSize: 28, fontWeight: 800, color: COLOR.ink }}>
                  {formatLivePrice(livePrice)}
                </span>
              ) : (
                <span style={{ fontSize: 20, fontWeight: 700, color: COLOR.inkMuted }}>
                  See current pricing on Shopify
                </span>
              )}
            </div>
            <ul style={{ padding: 0, listStyle: 'none', marginTop: 8 }}>
              {GROWTH_FEATURES.map((f, i) => (
                <li
                  key={f}
                  style={{
                    fontSize: 14,
                    padding: '7px 0',
                    color: i === 0 ? COLOR.inkSubtle : COLOR.ink,
                    fontStyle: i === 0 ? 'italic' : 'normal',
                    display: 'flex',
                    gap: 10,
                    lineHeight: 1.4,
                  }}
                >
                  {i > 0 && (
                    <span style={{ color: COLOR.success, fontWeight: 700, flexShrink: 0 }}>✓</span>
                  )}
                  <span style={i === 0 ? { paddingLeft: 0 } : undefined}>{f}</span>
                </li>
              ))}
            </ul>
            <div style={{ marginTop: 22 }}>
              <Button variant="primary" size="large" onClick={openUpgrade} fullWidth>
                {plan === 'GROWTH' ? 'Manage plan' : 'View plans'}
              </Button>
              {plan === 'GROWTH' && (
                <div style={{ marginTop: 8 }}>
                  <Button variant="plain" tone="critical" onClick={() => setCancelOpen(true)} fullWidth>
                    Cancel subscription
                  </Button>
                </div>
              )}
              <div
                style={{
                  fontSize: 11,
                  color: COLOR.inkSubtle,
                  marginTop: 10,
                  textAlign: 'center',
                }}
              >
                Billed through Shopify · change or cancel any time
              </div>
            </div>
          </div>
        </div>

        {/* FAQ */}
        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              Common questions
            </Text>
            {[
              {
                q: 'How does billing work?',
                a: 'Shopify handles it end to end. You pick a plan on Shopify’s plan page, approve the charge, and it appears on your regular Shopify invoice. Cancel from your Shopify admin any time — billing stops immediately, no questions.',
              },
              {
                q: 'What does a "gap" mean?',
                a: 'A gap is a real shopper search where something went wrong: nothing showed up, the wrong things showed up, or what showed up wasn’t worth clicking. Each one is a missed sale we can quantify.',
              },
              {
                q: 'Will this slow down my storefront?',
                a: 'No. The tracker is a 2KB script that fires after the page renders. It cannot block your checkout or product pages.',
              },
              {
                q: 'Can I downgrade later?',
                a: 'Yes — switch back to Free at any time from Shopify’s plan page. Your historical data stays.',
              },
            ].map((item) => (
              <BlockStack key={item.q} gap="100">
                <Text as="h3" variant="bodyMd" fontWeight="semibold">
                  {item.q}
                </Text>
                <Text as="p" tone="subdued" variant="bodySm">
                  {item.a}
                </Text>
              </BlockStack>
            ))}
          </BlockStack>
        </Card>
      </BlockStack>

      <UpgradeModal
        open={upgradeOpen}
        onClose={() => setUpgradeOpen(false)}
        storeId={summaryQ.data?.shopDomain ?? ''}
      />

      <Modal
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        title="Cancel your Growth subscription?"
        primaryAction={{
          content: 'Continue to Shopify',
          destructive: true,
          onAction: confirmCancel,
          loading: cancelUrl.isLoading,
          disabled: !cancelUrl.data?.url,
        }}
        secondaryActions={[{ content: 'Keep Growth', onAction: () => setCancelOpen(false) }]}
      >
        <Modal.Section>
          <BlockStack gap="300">
            <Text as="p">
              Cancelling is completed on Shopify&rsquo;s plan page — switch to the Free plan there
              and billing stops. We can&rsquo;t cancel it for you: Shopify owns the subscription
              and only lets the merchant change it.
            </Text>
            <Text as="p" tone="subdued" variant="bodySm">
              You&rsquo;ll go back to the top 5 gaps and lose revenue estimates, keyword fix
              suggestions and the weekly digest.{' '}
              <strong>Your historical data is kept</strong> — resubscribe any time and it&rsquo;s
              all still there. Shopify issues a prorated credit for the unused part of your billing
              cycle.
            </Text>
            {cancelUrl.isError && (
              <Banner tone="critical">
                Couldn&rsquo;t open the plan page: {cancelUrl.error?.message ?? 'unknown error'}
              </Banner>
            )}
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
