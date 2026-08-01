/**
 * Navigate the TOP window out of the embedded app frame.
 *
 * Anything on admin.shopify.com (the plan selection page, the app billing card)
 * refuses to be framed, so a same-frame navigation dies with
 * "admin.shopify.com refused to connect". App Bridge's redirectTo is the
 * supported way to drive the parent window from inside the iframe; the
 * window.open fallback covers the app being opened outside the admin.
 */
export function redirectTop(url: string): void {
  if (typeof window === 'undefined') return;
  const shopify = (
    window as unknown as {
      shopify?: { redirectTo?: (url: string, opts?: { target?: string }) => void };
    }
  ).shopify;
  if (shopify?.redirectTo) {
    shopify.redirectTo(url, { target: 'top' });
  } else {
    window.open(url, '_top');
  }
}
