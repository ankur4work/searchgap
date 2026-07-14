import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Shopify App Store req 1.2.2: on reinstall the app must re-request charge
 * approval rather than treating the pre-uninstall subscription as still active.
 * Shopify auto-cancels the app subscription on uninstall, so a reinstalled store
 * must be reset to FREE. A normal embedded-app open (store still installed) must
 * NOT touch the plan.
 */

const { storeUpsert, storeUpdate, storeFindUnique, billingEventCreate } = vi.hoisted(() => ({
  storeUpsert: vi.fn((_args: { update: Record<string, unknown> }) => Promise.resolve({ id: 'store1' })),
  storeUpdate: vi.fn((_args: { data: Record<string, unknown> }) => Promise.resolve({ id: 'store1' })),
  storeFindUnique: vi.fn<(args: unknown) => Promise<unknown>>(),
  billingEventCreate: vi.fn((_args: { data: { eventType: string } }) => Promise.resolve({ id: 'evt1' })),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    store: { upsert: storeUpsert, update: storeUpdate, findUnique: storeFindUnique },
    billingEvent: { create: billingEventCreate },
  },
}));

import { upsertStoreWithToken, refreshStoreToken } from '@/lib/shopify/store';

const TOKEN_INPUT = {
  shopDomain: 'shop.myshopify.com',
  accessToken: 'shpat_token',
  scope: 'read_products',
};

beforeEach(() => {
  storeUpsert.mockClear();
  storeUpdate.mockClear();
  storeFindUnique.mockReset();
  billingEventCreate.mockClear();
});

describe('reinstall billing reset', () => {
  it('upsertStoreWithToken resets plan to FREE when store was uninstalled', async () => {
    storeFindUnique.mockResolvedValue({
      id: 'store1',
      uninstalledAt: new Date('2026-07-01'),
      plan: 'GROWTH',
      shopifyChargeId: 'gid://shopify/AppSubscription/1',
    });

    await upsertStoreWithToken(TOKEN_INPUT);

    const updateData = storeUpsert.mock.calls[0]![0].update;
    expect(updateData.plan).toBe('FREE');
    expect(updateData.shopifyChargeId).toBeNull();
    expect(updateData.graceEndsAt).toBeNull();
    // A paid plan/charge existed, so the reset is audit-logged.
    expect(billingEventCreate).toHaveBeenCalledTimes(1);
    expect(billingEventCreate.mock.calls[0]![0].data.eventType).toBe('reinstall_billing_reset');
  });

  it('upsertStoreWithToken does NOT reset plan when store is still installed', async () => {
    storeFindUnique.mockResolvedValue({
      id: 'store1',
      uninstalledAt: null,
      plan: 'GROWTH',
      shopifyChargeId: 'gid://shopify/AppSubscription/1',
    });

    await upsertStoreWithToken(TOKEN_INPUT);

    const updateData = storeUpsert.mock.calls[0]![0].update;
    expect(updateData.plan).toBeUndefined();
    expect(updateData.shopifyChargeId).toBeUndefined();
    expect(billingEventCreate).not.toHaveBeenCalled();
  });

  it('refreshStoreToken resets plan to FREE on reinstall', async () => {
    storeFindUnique.mockResolvedValue({
      id: 'store1',
      uninstalledAt: new Date('2026-07-01'),
      plan: 'GROWTH',
      shopifyChargeId: 'gid://shopify/AppSubscription/1',
    });

    await refreshStoreToken(TOKEN_INPUT);

    const updateData = storeUpdate.mock.calls[0]![0].data;
    expect(updateData.plan).toBe('FREE');
    expect(updateData.shopifyChargeId).toBeNull();
    expect(updateData.graceEndsAt).toBeNull();
    expect(billingEventCreate).toHaveBeenCalledTimes(1);
  });

  it('refreshStoreToken leaves the plan untouched on a normal app open', async () => {
    storeFindUnique.mockResolvedValue({
      id: 'store1',
      uninstalledAt: null,
      plan: 'GROWTH',
      shopifyChargeId: 'gid://shopify/AppSubscription/1',
    });

    await refreshStoreToken(TOKEN_INPUT);

    const updateData = storeUpdate.mock.calls[0]![0].data;
    expect(updateData.plan).toBeUndefined();
    expect(updateData.shopifyChargeId).toBeUndefined();
    expect(billingEventCreate).not.toHaveBeenCalled();
  });

  it('does not audit-log when the reinstalled store had no paid plan or charge', async () => {
    storeFindUnique.mockResolvedValue({
      id: 'store1',
      uninstalledAt: new Date('2026-07-01'),
      plan: 'FREE',
      shopifyChargeId: null,
    });

    await refreshStoreToken(TOKEN_INPUT);

    // Still resets (harmless no-op), but nothing worth auditing.
    expect(billingEventCreate).not.toHaveBeenCalled();
  });
});
