import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { fetchActiveSubscription, planFromSubscription } from '@/lib/shopify/billing';
import { ShopDomainSchema } from '@/lib/shopify/validators';
import { track } from '@/lib/analytics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Welcome link for Shopify App Pricing.
 *
 * Configure this path as the plan's "Welcome link" in the dev dashboard.
 * Shopify redirects here after a merchant approves a plan and appends
 * `plan_handle` plus the shop domain — note there is NO `charge_id`, unlike the
 * old Billing API returnUrl this route used to serve.
 *
 * So rather than trusting a query param or a subscription id we stored at
 * create-time (the app no longer creates subscriptions at all), we ask Shopify
 * what the merchant is actually on. That also makes the route safe to hit
 * directly or replay: it simply reconciles against live state.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const shop = req.nextUrl.searchParams.get('shop');
  const planHandle = req.nextUrl.searchParams.get('plan_handle');

  const parsedShop = ShopDomainSchema.safeParse(shop);
  if (!parsedShop.success) {
    return NextResponse.json({ error: 'invalid shop' }, { status: 400 });
  }

  const store = await prisma.store.findUnique({ where: { shopDomain: parsedShop.data } });
  if (!store) {
    return NextResponse.json({ error: 'store not found' }, { status: 404 });
  }

  // Return the merchant to the embedded app inside Shopify admin instead of
  // back to our raw application_url (which in dev is localhost on a port the
  // browser can't reach).
  const shopHandle = parsedShop.data.replace(/\.myshopify\.com$/, '');
  const returnToApp = (): NextResponse =>
    NextResponse.redirect(
      `https://admin.shopify.com/store/${encodeURIComponent(shopHandle)}/apps/${encodeURIComponent(env.SHOPIFY_API_KEY)}`,
      302,
    );

  let sub;
  try {
    sub = await fetchActiveSubscription(store);
  } catch (err) {
    // Don't strand the merchant on an error page — the app_subscriptions/update
    // webhook and billing.currentPlan both reconcile plan state independently.
    logger.warn(
      { shop: store.shopDomain, err: (err as Error).message },
      'billing callback: could not read subscription; deferring to webhook',
    );
    return returnToApp();
  }

  const plan = planFromSubscription(sub);

  if (sub && plan === 'GROWTH') {
    // Amount comes from the live subscription, never from config: the app
    // owner sets pricing in the dashboard and it must be recorded as billed.
    const amountCents = sub.price ? Math.round(Number(sub.price.amount) * 100) : 0;

    const alreadyRecorded = await prisma.billingEvent.findFirst({
      where: { storeId: store.id, shopifyChargeId: sub.id, eventType: 'charge_activated' },
    });

    await prisma.$transaction([
      prisma.store.update({
        where: { id: store.id },
        data: { plan: 'GROWTH', graceEndsAt: null, shopifyChargeId: sub.id },
      }),
      ...(alreadyRecorded
        ? []
        : [
            prisma.billingEvent.create({
              data: {
                storeId: store.id,
                eventType: 'charge_activated',
                amountCents: Number.isFinite(amountCents) ? amountCents : 0,
                shopifyChargeId: sub.id,
              },
            }),
          ]),
    ]);

    track({
      event: 'billing_charge_activated',
      distinctId: store.id,
      properties: {
        shop: store.shopDomain,
        plan: 'GROWTH',
        chargeId: sub.id,
        planHandle,
        planName: sub.name,
      },
    });
    logger.info(
      { shop: store.shopDomain, chargeId: sub.id, planHandle, amountCents },
      'Plan upgraded to GROWTH',
    );
  } else {
    logger.info(
      { shop: store.shopDomain, status: sub?.status ?? 'none', planHandle },
      'billing callback: no active subscription yet',
    );
  }

  return returnToApp();
}
