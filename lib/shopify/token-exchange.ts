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
 * MUST request an EXPIRING token. Do not remove `expiring=1`.
 *
 * Shopify no longer accepts non-expiring offline tokens on the Admin API. Ask
 * for one and every Admin API call fails:
 *
 *   403 {"errors":"[API] Non-expiring access tokens are no longer accepted for
 *        the Admin API. Start using expiring offline tokens"}
 *
 * That is not a theory — it is what happened when this request briefly dropped
 * the flag on 2026-08-19, and it broke orders and products sync outright.
 *
 * The tokens Shopify returns live one hour (`expires_in: 3599`). That is a real
 * constraint to design around, NOT something to fix here: see
 * `isTokenExpired` and the ingestion processors for how a lapsed token is
 * handled, and note that refreshing currently requires a merchant to open the
 * app, because token exchange needs a session token only the browser can mint.
 *
 * https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/offline-access-tokens
 */
export async function exchangeOfflineAccessToken(input: {
  shop: string;
  sessionToken: string;
}): Promise<{ accessToken: string; scope: string; expiresIn: number | null }> {
  const res = await fetch(`https://${input.shop}/admin/oauth/access_token?expiring=1`, {
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
      expiring: 1,
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

  // A token with no expiry is rejected by the Admin API with a 403 on every
  // call, so catch it here rather than at the first sync that fails.
  if (json.expires_in == null) {
    logger.error(
      { shop: input.shop, responseKeys: Object.keys(json) },
      'Shopify returned a NON-EXPIRING offline token — the Admin API will reject every call with 403',
    );
  }

  return {
    accessToken: json.access_token,
    scope: json.scope,
    expiresIn: json.expires_in ?? null,
  };
}
