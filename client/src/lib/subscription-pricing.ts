export type BillingInterval = 'month' | 'year';

export interface SubscriptionPrice {
  id: string;
  unit_amount: number | null;
  currency?: string;
  type?: string;
  active?: boolean;
  product?: string;
  recurring?: {
    interval?: string;
    interval_count?: number;
  } | null;
}

export const FALLBACK_MONTHLY_PRICE_CENTS = 999;
export const FALLBACK_YEARLY_PRICE_CENTS = 9900;

export function getSubscriptionPriceOptions(prices: SubscriptionPrice[] = []) {
  const byProduct = new Map<string, { monthly?: SubscriptionPrice; yearly?: SubscriptionPrice }>();

  for (const price of prices) {
    if (price.active === false || (price.type && price.type !== 'recurring')) continue;
    const interval = price.recurring?.interval;
    if (interval !== 'month' && interval !== 'year') continue;

    const productKey = price.product || '__unknown_product__';
    const group = byProduct.get(productKey) || {};
    if (interval === 'month' && !group.monthly) group.monthly = price;
    if (interval === 'year' && !group.yearly) group.yearly = price;
    byProduct.set(productKey, group);
  }

  const groups = Array.from(byProduct.values());
  const matchedProduct = groups.find(group => group.monthly && group.yearly);
  if (matchedProduct) return matchedProduct;

  const monthlyOnlyProduct = groups.find(group => group.monthly);
  return {
    monthly: monthlyOnlyProduct?.monthly,
    yearly: undefined,
  };
}
