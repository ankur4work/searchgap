'use client';

import { Modal, BlockStack, Text, List, Banner, Spinner } from '@shopify/polaris';
import { trpc } from '@/lib/trpc/client';
import { analytics } from './analytics-client';
import { redirectTop } from './redirect-top';

interface Props {
  open: boolean;
  onClose: () => void;
  storeId: string;
}

/**
 * Sends the merchant to Shopify's hosted plan selection page.
 *
 * Under Shopify App Pricing the app doesn't create the charge and — critically
 * — doesn't state the price. The amount is set by the app owner in the dev
 * dashboard and can change at any time; printing a number here would be a copy
 * of that setting that silently rots. Shopify's page is the single place the
 * merchant sees, and agrees to, what they'll be billed.
 */
export function UpgradeModal({ open, onClose, storeId }: Props): JSX.Element {
  // Only fetch once the modal is open — no point resolving a URL for a dialog
  // the merchant may never open.
  const planUrl = trpc.billing.planSelectionUrl.useQuery(undefined, { enabled: open });

  const handleUpgrade = (): void => {
    analytics.track('upgrade_cta_clicked', { storeId });
    const url = planUrl.data?.url;
    if (!url) return;
    redirectTop(url);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Upgrade to Growth"
      primaryAction={{
        content: 'View plans',
        onAction: handleUpgrade,
        loading: planUrl.isLoading,
        disabled: !planUrl.data?.url,
      }}
      secondaryActions={[{ content: 'Not now', onAction: onClose }]}
    >
      <Modal.Section>
        <BlockStack gap="400">
          <Text as="p">Growth unlocks:</Text>
          <List type="bullet">
            <List.Item>
              Every product gap — not just the top 5 — with full revenue numbers.
            </List.Item>
            <List.Item>A dollar revenue estimate on each gap, with a low/high band.</List.Item>
            <List.Item>Keyword fix suggestions with the matched product title.</List.Item>
            <List.Item>Weekly digest email summarizing new gaps and estimated impact.</List.Item>
            <List.Item>Priority email support.</List.Item>
          </List>

          {planUrl.isLoading && <Spinner accessibilityLabel="Loading plans" size="small" />}

          {planUrl.isError && (
            <Banner tone="critical">
              Couldn&rsquo;t open plans: {planUrl.error?.message ?? 'unknown error'}
            </Banner>
          )}

          <Text as="p" tone="subdued" variant="bodySm">
            Pricing and any current offers are shown on Shopify&rsquo;s plan page. Billed through
            Shopify — change or cancel any time from your Shopify admin.
          </Text>
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
}
