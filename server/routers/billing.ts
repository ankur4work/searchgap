import { TRPCError } from '@trpc/server';
import { protectedProcedure, router } from '../trpc';
import {
  fetchActiveSubscription,
  planFromSubscription,
  planSelectionUrl,
} from '@/lib/shopify/billing';

/**
 * Billing under Shopify App Pricing.
 *
 * The app no longer creates or cancels charges — Shopify owns the whole
 * lifecycle from its hosted plan selection page. What remains here is read-only
 * (what is this merchant on, right now, and at what price) plus the URL that
 * sends them to Shopify to change it.
 *
 * Nothing in this file may hard-code an amount: pricing is editable in the dev
 * dashboard and has to take effect without a deploy.
 */
export const billingRouter = router({
  /**
   * The merchant's plan, price and status.
   *
   * Reads Shopify first so a dashboard price change or a merchant upgrade shows
   * up immediately, and reconciles the `Store.plan` cache when the two disagree
   * — the app_subscriptions/update webhook keeps that column warm, but a missed
   * or delayed delivery would otherwise strand a paying merchant on FREE.
   *
   * On a Shopify API failure this falls back to the cached column rather than
   * throwing, so a billing outage degrades to stale-but-usable instead of
   * breaking the dashboard.
   */
  currentPlan: protectedProcedure.query(async ({ ctx }) => {
    if (!ctx.session.storeId) {
      return {
        plan: 'FREE' as const,
        graceEndsAt: null,
        shopifyChargeId: null,
        price: null,
        planName: null,
        status: null,
        stale: false,
      };
    }

    const store = await ctx.prisma.store.findUnique({
      where: { id: ctx.session.storeId },
      select: {
        id: true,
        shopDomain: true,
        accessToken: true,
        plan: true,
        graceEndsAt: true,
        shopifyChargeId: true,
      },
    });
    if (!store) throw new TRPCError({ code: 'NOT_FOUND', message: 'Store missing' });

    try {
      const sub = await fetchActiveSubscription(store);
      const livePlan = planFromSubscription(sub);

      // Log what Shopify actually returned. Without this, a plan resolving the
      // wrong way is invisible: the app just quietly shows the free tier.
      ctx.logger.info(
        {
          shop: store.shopDomain,
          subName: sub?.name ?? null,
          subStatus: sub?.status ?? null,
          subTest: sub?.test ?? null,
          priceAmount: sub?.price?.amount ?? null,
          priceCurrency: sub?.price?.currencyCode ?? null,
          resolvedPlan: livePlan,
        },
        'billing.currentPlan resolved subscription',
      );

      if (livePlan !== store.plan) {
        await ctx.prisma.store.update({
          where: { id: store.id },
          data: {
            plan: livePlan,
            shopifyChargeId: sub?.id ?? null,
            ...(livePlan === 'GROWTH' ? { graceEndsAt: null } : {}),
          },
        });
        ctx.logger.info(
          { shop: store.shopDomain, cached: store.plan, live: livePlan },
          'billing.currentPlan reconciled cached plan against Shopify',
        );
      }

      return {
        plan: livePlan,
        graceEndsAt: livePlan === 'GROWTH' ? null : store.graceEndsAt,
        shopifyChargeId: sub?.id ?? null,
        price: sub?.price ?? null,
        planName: sub?.name ?? null,
        status: sub?.status ?? null,
        stale: false,
      };
    } catch (err) {
      ctx.logger.warn(
        { shop: store.shopDomain, err: (err as Error).message },
        'billing.currentPlan could not reach Shopify — serving cached plan',
      );
      return {
        plan: store.plan,
        graceEndsAt: store.graceEndsAt,
        shopifyChargeId: store.shopifyChargeId,
        price: null,
        planName: null,
        status: null,
        stale: true,
      };
    }
  }),

  /**
   * Shopify-hosted plan selection page. The client must open this at the TOP
   * window — it lives on admin.shopify.com and cannot render inside the app
   * frame.
   *
   * Upgrades, downgrades and cancellation all happen there, which is why this
   * router no longer exposes createCharge / cancelSubscription.
   */
  planSelectionUrl: protectedProcedure.query(async ({ ctx }) => {
    if (!ctx.session.storeId) throw new TRPCError({ code: 'UNAUTHORIZED' });
    const store = await ctx.prisma.store.findUnique({
      where: { id: ctx.session.storeId },
      select: { shopDomain: true },
    });
    if (!store) throw new TRPCError({ code: 'NOT_FOUND', message: 'Store missing' });
    return { url: planSelectionUrl(store.shopDomain) };
  }),
});
