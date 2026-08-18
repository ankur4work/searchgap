import { env } from '../env';
import { logger } from '../logger';

interface ExchangeResponse {
  access_token: string;
  scope: string;
  expires_in?: number;
}

/**
 * Token Exchange — single-step, session token (id_token) → offline access token.
 *
 * We request a NON-expiring offline token. Do not reintroduce `expiring=1`.
 *
 * This previously asked for an expiring token, and Shopify returned
 * `expires_in: 3599` — one hour. The only code path that mints a new token is
 * the embedded bootstrap, which runs when a merchant OPENS the app. So every
 * scheduled sync more than an hour after the last app open hit
 * `isTokenExpired` and skipped:
 *
 *   13:06Z  bootstrap -> fresh token
 *   20:33Z  cron -> "Access token expired - skipping products/orders/search sync"
 *
 * Storefront data therefore froze whenever nobody was looking at the dashboard,
 * which is exactly the "fails to synchronize with the store" behaviour this app
 * was rejected for. A background-sync app cannot depend on a one-hour
 * credential that only refreshes while a human is present.
 *
 * Offline tokens are the correct grant for unattended work and do not expire.
 * If Shopify ever forces expiry regardless of this request, the fix is a
 * refresh path the worker can drive on its own — NOT waiting for an app open.
 *
 * https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/exchange
 */
export async function exchangeOfflineAccessToken(input: {
  shop: string;
  sessionToken: string;
}): Promise<{ accessToken: string; scope: string; expiresIn: number | null }> {
  const res = await fetch(`https://${input.shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({
      client_id: env.SHOPIFY_API_KEY,
      client_secret: env.SHOPIFY_API_SECRET,
      grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
      subject_token: input.sessionToken,
      subject_token_type: 'urn:ietf:params:oauth:token-type:id_token',
      requested_token_type: 'urn:shopify:params:oauth:token-type:offline-access-token',
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    logger.error({ shop: input.shop, status: res.status, body }, 'Token exchange failed');
    throw new Error(`Token exchange failed: ${res.status} ${body}`);
  }

  const json = (await res.json()) as ExchangeResponse;
  logger.info(
    {
      shop: input.shop,
      scope: json.scope,
      expiresIn: json.expires_in ?? null,
      tokenPrefix: json.access_token.slice(0, 8),
    },
    'Token exchange response',
  );

  // Loud, because the failure it precedes is silent: background syncs simply
  // stop once the token lapses, and the dashboard quietly serves stale figures.
  // If this ever fires, unattended sync is broken again and the worker needs a
  // refresh path of its own.
  if (json.expires_in != null) {
    logger.error(
      { shop: input.shop, expiresIn: json.expires_in },
      'Shopify returned an EXPIRING offline token despite a non-expiring request — scheduled syncs will stop once it lapses',
    );
  }

  return {
    accessToken: json.access_token,
    scope: json.scope,
    expiresIn: json.expires_in ?? null,
  };
}
