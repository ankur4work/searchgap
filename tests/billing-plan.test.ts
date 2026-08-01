import { describe, it, expect } from 'vitest';
import { planFromSubscription, type ActiveSubscription } from '@/lib/shopify/billing';

function sub(over: Partial<ActiveSubscription> = {}): ActiveSubscription {
  return {
    id: 'gid://shopify/AppSubscription/1',
    name: 'Growth',
    status: 'ACTIVE',
    test: false,
    trialDays: 0,
    currentPeriodEnd: null,
    price: { amount: '9.00', currencyCode: 'USD', interval: 'EVERY_30_DAYS' },
    ...over,
  };
}

describe('planFromSubscription', () => {
  it('no subscription → FREE', () => {
    expect(planFromSubscription(null)).toBe('FREE');
  });

  it('active paid subscription → GROWTH', () => {
    expect(planFromSubscription(sub())).toBe('GROWTH');
  });

  // A Free plan defined in the dashboard produces a real ACTIVE subscription,
  // so entitlement can't key off the subscription merely existing.
  it('managed Free plan → FREE', () => {
    const free = sub({
      name: 'Free',
      price: { amount: '0.00', currencyCode: 'USD', interval: 'EVERY_30_DAYS' },
    });
    expect(planFromSubscription(free)).toBe('FREE');
  });

  it('free plan name match is case- and whitespace-insensitive', () => {
    expect(planFromSubscription(sub({ name: '  free  ' }))).toBe('FREE');
    expect(planFromSubscription(sub({ name: 'FREE' }))).toBe('FREE');
  });

  /**
   * Regression: the first real install. A development store on the Growth plan
   * gets it at $0 via "Free for partners and developers". An amount-based check
   * read that as free and locked the partner out of the paid features they were
   * installing specifically to test — while the webhook had already recorded
   * GROWTH, so the two sources disagreed.
   */
  it('paid plan granted free to a development store → GROWTH, not FREE', () => {
    const devStore = sub({
      name: 'Growth',
      test: true,
      price: { amount: '0.00', currencyCode: 'USD', interval: 'EVERY_30_DAYS' },
    });
    expect(planFromSubscription(devStore)).toBe('GROWTH');
  });

  it('paid plan with no recurring line item still resolves by name', () => {
    expect(planFromSubscription(sub({ price: null }))).toBe('GROWTH');
  });

  it.each(['PENDING', 'CANCELLED', 'EXPIRED', 'FROZEN', 'DECLINED'])(
    'non-active status %s → FREE',
    (status) => {
      expect(planFromSubscription(sub({ status }))).toBe('FREE');
    },
  );

  // Entitlement must not depend on the amount — the app owner edits pricing in
  // the dashboard and it takes effect with no deploy.
  it.each(['0.00', '1.00', '9.00', '12.00', '499.00'])(
    'amount %s does not change the tier for a paid plan name',
    (amount) => {
      const s = sub({ price: { amount, currencyCode: 'USD', interval: 'EVERY_30_DAYS' } });
      expect(planFromSubscription(s)).toBe('GROWTH');
    },
  );

  it('non-USD annual plan is paid', () => {
    const s = sub({ price: { amount: '750.00', currencyCode: 'INR', interval: 'ANNUAL' } });
    expect(planFromSubscription(s)).toBe('GROWTH');
  });
});
