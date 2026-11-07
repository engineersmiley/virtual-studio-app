import type Stripe from "stripe";

// The installed sync SDK enumerates every cached database customer for this
// step, including customers belonging to another account or test/live mode.
// Enumerate through the authenticated API instead; let the SDK own all writes.
export function scopePaymentMethodBackfill(sync: {
  getAccountId(): Promise<string>;
  upsertPaymentMethods(items: Stripe.PaymentMethod[], accountId: string, related?: boolean): Promise<unknown>;
  syncPaymentMethods: (options?: { backfillRelatedEntities?: boolean }) => Promise<{ synced: number }>;
}, stripe: Stripe) {
  sync.syncPaymentMethods = async (options) => {
    const accountId = await sync.getAccountId();
    let synced = 0;
    for await (const customer of stripe.customers.list({ limit: 100 })) {
      let batch: Stripe.PaymentMethod[] = [];
      for await (const method of stripe.paymentMethods.list({ customer: customer.id, limit: 100 })) {
        batch.push(method);
        if (batch.length === 100) {
          await sync.upsertPaymentMethods(batch, accountId, options?.backfillRelatedEntities);
          synced += batch.length;
          batch = [];
        }
      }
      if (batch.length) {
        await sync.upsertPaymentMethods(batch, accountId, options?.backfillRelatedEntities);
        synced += batch.length;
      }
    }
    return { synced };
  };
}
