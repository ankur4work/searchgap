'use client';

import {
  Card,
  ResourceList,
  ResourceItem,
  Text,
  BlockStack,
  InlineStack,
  Badge,
} from '@shopify/polaris';
import { trpc } from '@/lib/trpc/client';

interface Type2Gap {
  id: string;
  queryNorm: string;
  confidence: number;
  matchedProductIds: string[];
  matchedProductTitles: string[];
  locked: boolean;
}

/**
 * Read-only list of TYPE_2 (keyword/synonym) gaps.
 *
 * This deliberately has no props: the one-click synonym write-back to Shopify
 * Search & Discovery was removed along with the write scope (see
 * docs/APP_LISTING.md), so there is no plan gate, no store context and no
 * upgrade path to drive from here. Fixes are presented as suggestions the
 * merchant applies manually.
 */
export function KeywordFixesSection(): JSX.Element {
  const gaps = trpc.dashboard.gaps.useQuery({ type: 'TYPE_2', limit: 20, offset: 0 });

  return (
    <Card>
      <BlockStack gap="300">
        <BlockStack gap="100">
          <Text as="h2" variant="headingMd">
            Keyword fixes
          </Text>
          <Text as="p" variant="bodySm" tone="subdued">
            Customers searched these terms but found the wrong product. Add synonyms manually in{' '}
            <strong>Shopify Search &amp; Discovery</strong> to fix them.
          </Text>
        </BlockStack>
        <ResourceList
          resourceName={{ singular: 'fix', plural: 'fixes' }}
          items={(gaps.data?.gaps ?? []) as Type2Gap[]}
          loading={gaps.isLoading}
          renderItem={(item) => {
            const row = item as Type2Gap;
            const target = row.matchedProductTitles[0];
            return (
              <ResourceItem
                id={row.id}
                accessibilityLabel={`${row.queryNorm} → ${target ?? 'no match'}`}
                onClick={() => { /* read-only */ }}
              >
                <InlineStack align="space-between" blockAlign="center">
                  <BlockStack gap="050">
                    <Text as="p" variant="bodyMd" fontWeight="semibold">
                      {row.queryNorm}{' '}
                      <Text as="span" tone="subdued">
                        →
                      </Text>{' '}
                      <em>{target ?? '(no match)'}</em>
                    </Text>
                    <Badge tone="info">{`${Math.round(row.confidence * 100)}% match`}</Badge>
                  </BlockStack>
                </InlineStack>
              </ResourceItem>
            );
          }}
        />
      </BlockStack>
    </Card>
  );
}
