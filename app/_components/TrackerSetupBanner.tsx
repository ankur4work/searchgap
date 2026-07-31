'use client';

import { Banner, BlockStack, Text, InlineStack, Button } from '@shopify/polaris';

interface Props {
  shopDomain: string;
  /** Whether the optional theme app embed is enabled (null = couldn't tell). */
  embedEnabled: boolean | null;
  /** Whether the storefront is password-protected (null = couldn't tell). */
  passwordProtected?: boolean | null;
}

/**
 * Honest "waiting for first searches" state. Tracking is auto-enabled at
 * install via a ScriptTag (see lib/shopify/script-tag.ts), so this is NOT an
 * "action required" blocker — searches are already being captured. We just
 * haven't seen one yet. We tell the merchant to run a test search and, only as
 * an optional fallback (e.g. a theme that strips injected scripts), offer the
 * one-toggle theme app embed.
 *
 * If the storefront is password-protected (default on dev/unpublished stores),
 * "Open storefront" would dead-end on Shopify's password gate — so we swap it
 * for a clear hint + a direct link to the password preferences page instead.
 */
export function TrackerSetupBanner({ shopDomain, embedEnabled, passwordProtected }: Props): JSX.Element {
  const themeEditorUrl = `https://${shopDomain}/admin/themes/current/editor?context=apps`;
  const passwordPrefsUrl = `https://${shopDomain}/admin/online_store/preferences`;
  // A search URL demonstrates the tracker capturing a real query, rather than
  // just opening the storefront home.
  const testSearchUrl = `https://${shopDomain}/search?q=test+product`;

  return (
    <Banner tone="info" title="Tracking is live — waiting for your first search">
      <BlockStack gap="200">
        <Text as="p" variant="bodyMd">
          GapFinder is connected and automatically tracking storefront searches. We haven&rsquo;t
          captured any yet. Run a search on your storefront (try a term you don&rsquo;t sell) and it
          will appear here within a minute or two.
        </Text>

        {passwordProtected === true && (
          <Banner tone="warning">
            <Text as="p" variant="bodyMd">
              Your storefront is <strong>password-protected</strong>, so it (and any test search)
              will ask for a password. This is a Shopify store setting — not GapFinder — and
              won&rsquo;t affect live, published stores. To test now, remove the password under{' '}
              <strong>Online Store → Preferences → Password protection</strong>.
            </Text>
          </Banner>
        )}

        {embedEnabled !== true && (
          <Text as="p" variant="bodySm" tone="subdued">
            Not seeing data after a test search? Some themes strip injected scripts. As a backup you
            can enable the theme app embed: open the theme editor, find <strong>App embeds</strong>{' '}
            (puzzle-piece icon), toggle <strong>GapFinder Tracker</strong> ON, then{' '}
            <strong>Save</strong>. (The theme editor works without the storefront password.)
          </Text>
        )}

        <InlineStack gap="200">
          {passwordProtected === true ? (
            <Button url={passwordPrefsUrl} external target="_top" variant="primary">
              Remove storefront password
            </Button>
          ) : (
            <Button url={testSearchUrl} external target="_top">
              Run a test search
            </Button>
          )}
          {embedEnabled !== true && (
            <Button url={themeEditorUrl} external target="_top">
              Open theme editor
            </Button>
          )}
          <Button url="/methodology">What does it track?</Button>
        </InlineStack>
      </BlockStack>
    </Banner>
  );
}
