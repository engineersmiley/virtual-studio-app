import type { BillingInterval } from "@/lib/subscription-pricing";

interface SubscriptionPlanSelectorProps {
  interval: BillingInterval;
  onChange: (interval: BillingInterval) => void;
  monthlyAmountCents: number;
  yearlyAmountCents: number;
  yearlyCheckoutAvailable: boolean;
}

function formatUsd(amountCents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amountCents / 100);
}

export function SubscriptionPlanSelector({
  interval,
  onChange,
  monthlyAmountCents,
  yearlyAmountCents,
  yearlyCheckoutAvailable,
}: SubscriptionPlanSelectorProps) {
  const savingsPercent = monthlyAmountCents > 0
    ? Math.max(0, Math.round((1 - yearlyAmountCents / (monthlyAmountCents * 12)) * 100))
    : 0;

  const optionClass = (selected: boolean) =>
    `min-h-16 rounded-lg border p-3 text-left transition-colors ${
      selected
        ? "border-secondary bg-secondary/10 ring-1 ring-secondary/40"
        : "border-white/10 bg-background/30 hover:border-white/25"
    }`;

  return (
    <div className="grid grid-cols-2 gap-2" role="group" aria-label="Choose billing period">
      <button
        type="button"
        aria-pressed={interval === "month"}
        data-testid="billing-option-month"
        className={optionClass(interval === "month")}
        onClick={() => onChange("month")}
      >
        <span className="block text-sm font-semibold">Monthly</span>
        <span className="mt-1 block text-xs text-muted-foreground">
          {formatUsd(monthlyAmountCents)} / month
        </span>
      </button>
      <button
        type="button"
        aria-pressed={interval === "year"}
        data-testid="billing-option-year"
        className={optionClass(interval === "year")}
        onClick={() => onChange("year")}
      >
        <span className="flex items-center justify-between gap-1 text-sm font-semibold">
          Yearly
          {savingsPercent > 0 && (
            <span className="rounded-full bg-secondary/15 px-2 py-0.5 text-[10px] text-secondary">
              Save {savingsPercent}%
            </span>
          )}
        </span>
        <span className="mt-1 block text-xs text-muted-foreground">
          {formatUsd(yearlyAmountCents)} / year
        </span>
        {!yearlyCheckoutAvailable && (
          <span className="mt-1 block text-[10px] text-amber-300">
            Checkout setup pending
          </span>
        )}
      </button>
    </div>
  );
}
