'use client';

import { useCallback, useState } from 'react';
import { Page, BlockStack, Card, Text, Button, Banner, Modal } from '@shopify/polaris';
import { trpc } from '@/lib/trpc/client';
import { useTrpcAuth } from '@/lib/trpc/provider';
import { UpgradeModal } from '../_components/UpgradeModal';
import { analytics } from '../_components/analytics-client';
import { BRAND, COLOR, RADIUS, SHADOW } from '../_components/brand';

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

export default function PricingPage(): JSX.Element {
  const auth = useTrpcAuth();
  const planQ = trpc.billing.currentPlan.useQuery(undefined, { enabled: auth.ready });
  const summaryQ = trpc.dashboard.summary.useQuery(undefined, { enabled: auth.ready });
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [downgradeOpen, setDowngradeOpen] = useState(false);
  const plan = planQ.data?.plan ?? 'FREE';
  const utils = trpc.useUtils();

  const cancelSub = trpc.billing.cancelSubscription.useMutation({
    onSuccess: () => {
      setDowngradeOpen(false);
      void utils.billing.currentPlan.invalidate();
      void utils.dashboard.summary.invalidate();
    },
  });

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
            <p>Thanks for upgrading. You have access to everything below.</p>
          </Banner>
        )}

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
          {/* FREE */}
          <div
            style={{
              flex: '1 1 320px',
              minWidth: 280,
              border:
                plan === 'FREE' ? `2px solid ${COLOR.primary}` : `1px solid ${COLOR.border}`,
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
              <span style={{ fontSize: 40, fontWeight: 800, color: COLOR.ink }}>$0</span>
              <span style={{ fontSize: 14, color: COLOR.inkSubtle, marginLeft: 6 }}>
                / month forever
              </span>
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
                plan === 'GROWTH'
                  ? `2px solid ${COLOR.success}`
                  : `2px solid ${COLOR.primary}`,
              borderRadius: RADIUS.lg,
              padding: '28px 30px',
              background:
                plan === 'GROWTH'
                  ? COLOR.surface
                  : `linear-gradient(180deg, ${COLOR.tint50} 0%, ${COLOR.surface} 60%)`,
              position: 'relative',
              boxShadow:
                plan === 'GROWTH' ? 'none' : SHADOW.md,
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
              <span style={{ fontSize: 40, fontWeight: 800, color: COLOR.ink }}>$9</span>
              <span style={{ fontSize: 14, color: COLOR.inkSubtle, marginLeft: 6 }}>/ month</span>
              <span
                style={{
                  marginLeft: 12,
                  fontSize: 11,
                  background: COLOR.successBg,
                  color: COLOR.successFg,
                  padding: '2px 8px',
                  borderRadius: RADIUS.pill,
                  fontWeight: 700,
                }}
              >
                Cancel anytime
              </span>
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
            {plan === 'FREE' && (
              <div style={{ marginTop: 22 }}>
                <Button variant="primary" size="large" onClick={openUpgrade} fullWidth>
                  Start Growth · $9/mo
                </Button>
                <div style={{ fontSize: 11, color: COLOR.inkSubtle, marginTop: 10, textAlign: 'center' }}>
                  Cancel anytime · Billed through Shopify · No credit card extra
                </div>
              </div>
            )}
            {plan === 'GROWTH' && (
              <div style={{ marginTop: 22 }}>
                <Button
                  variant="plain"
                  tone="critical"
                  onClick={() => setDowngradeOpen(true)}
                  fullWidth
                >
                  Downgrade to Free
                </Button>
              </div>
            )}
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
                a: 'You start Growth instantly and Shopify bills $9 as soon as you approve. Cancel from your Shopify admin any time — billing stops immediately, no questions.',
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
                a: 'Yes — drop back to Free at any time from Shopify’s billing UI. Your historical data stays.',
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
        open={downgradeOpen}
        onClose={() => setDowngradeOpen(false)}
        title="Downgrade to Free?"
        primaryAction={{
          content: 'Yes, downgrade',
          destructive: true,
          loading: cancelSub.isPending,
          onAction: () => cancelSub.mutate(),
        }}
        secondaryActions={[{ content: 'Keep Growth', onAction: () => setDowngradeOpen(false) }]}
      >
        <Modal.Section>
          <Text as="p">
            Your subscription will be cancelled immediately. You&rsquo;ll lose access to the full
            gap list, revenue estimates, and digest emails. Your historical data stays.
          </Text>
          {cancelSub.isError && (
            <div style={{ marginTop: 12 }}>
              <Text as="p" tone="critical">
                {cancelSub.error.message}
              </Text>
            </div>
          )}
        </Modal.Section>
      </Modal>
    </Page>
  );
}
