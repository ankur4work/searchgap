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

  // A Free plan defined in the dashboard still creates a real ACTIVE
  // subscription, just with a $0 recurring price. Keying entitlement off the
  // mere existence of a subscription would hand every free merchant the paid
  // feature set.
  it('active $0 managed Free plan → FREE, not GROWTH', () => {
    const free = sub({
      name: 'Free',
      price: { amount: '0.00', currencyCode: 'USD', interval: 'EVERY_30_DAYS' },
    });
    expect(planFromSubscription(free)).toBe('FREE');
  });

  it('active subscription with no recurring line item → FREE', () => {
    expect(planFromSubscription(sub({ price: null }))).toBe('FREE');
  });

  it.each(['PENDING', 'CANCELLED', 'EXPIRED', 'FROZEN', 'DECLINED'])(
    'non-active status %s → FREE even with a price',
    (status) => {
      expect(planFromSubscription(sub({ status }))).toBe('FREE');
    },
  );

  // Entitlement must not depend on the amount itself — the app owner edits
  // pricing in the dashboard and it takes effect with no deploy.
  it.each(['1.00', '9.00', '12.00', '499.00'])('any positive price %s → GROWTH', (amount) => {
    const s = sub({ price: { amount, currencyCode: 'USD', interval: 'EVERY_30_DAYS' } });
    expect(planFromSubscription(s)).toBe('GROWTH');
  });

  it('non-USD currency is still paid', () => {
    const s = sub({ price: { amount: '750.00', currencyCode: 'INR', interval: 'ANNUAL' } });
    expect(planFromSubscription(s)).toBe('GROWTH');
  });

  it('garbage amount is treated as unpaid rather than failing open', () => {
    const s = sub({ price: { amount: 'not-a-number', currencyCode: 'USD', interval: 'EVERY_30_DAYS' } });
    expect(planFromSubscription(s)).toBe('FREE');
  });
});
