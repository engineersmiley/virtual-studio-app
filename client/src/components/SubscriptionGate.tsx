import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Crown, CreditCard, Loader2, Check, ArrowLeft, Gift } from "lucide-react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { SubscriptionPlanSelector } from "@/components/SubscriptionPlanSelector";
import {
  FALLBACK_MONTHLY_PRICE_CENTS,
  FALLBACK_YEARLY_PRICE_CENTS,
  getSubscriptionPriceOptions,
} from "@/lib/subscription-pricing";
import type { BillingInterval, SubscriptionPrice } from "@/lib/subscription-pricing";

interface SubscriptionGateProps {
  children: React.ReactNode;
}

const STORAGE_KEY = "studiolink_subscriber_email";

export function SubscriptionGate({ children }: SubscriptionGateProps) {
  const [, navigate] = useLocation();
  const [email, setEmail] = useState("");
  const [checkEmail, setCheckEmail] = useState("");
  const [promoCode, setPromoCode] = useState("");
  const [showPromo, setShowPromo] = useState(false);
  const [billingInterval, setBillingInterval] = useState<BillingInterval>("month");
  const { toast } = useToast();

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      setEmail(stored);
      setCheckEmail(stored);
    }
  }, []);

  const { data: pricesData } = useQuery<{ prices: SubscriptionPrice[] }>({
    queryKey: ['/api/stripe/prices'],
  });
  const priceOptions = getSubscriptionPriceOptions(pricesData?.prices);
  const monthlyPrice = priceOptions.monthly;
  const yearlyPrice = priceOptions.yearly;
  const monthlyAmountCents = monthlyPrice?.unit_amount ?? FALLBACK_MONTHLY_PRICE_CENTS;
  const yearlyAmountCents = yearlyPrice?.unit_amount ?? FALLBACK_YEARLY_PRICE_CENTS;
  const selectedPrice = billingInterval === "year" ? yearlyPrice : monthlyPrice;
  const selectedAmountCents = billingInterval === "year" ? yearlyAmountCents : monthlyAmountCents;
  const selectedPriceLabel = (selectedAmountCents / 100).toFixed(2);

  const { data: subscriptionData, isLoading: checkingSubscription } = useQuery<{
    hasSubscription: boolean;
    status: string | null;
  }>({
    queryKey: ['/api/subscription-status', checkEmail],
    queryFn: async () => {
      if (!checkEmail) return { hasSubscription: false, status: null };
      const res = await fetch(`/api/subscription-status?email=${encodeURIComponent(checkEmail)}`);
      return res.json();
    },
    enabled: !!checkEmail,
  });

  const checkoutMutation = useMutation({
    mutationFn: async ({ email, priceId }: { email: string; priceId: string }) => {
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, priceId }),
      });
      if (!res.ok) throw new Error('Failed to create checkout');
      return res.json();
    },
    onSuccess: (data) => {
      if (data.url) {
        localStorage.setItem(STORAGE_KEY, email);
        window.location.href = data.url;
      }
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Could not start checkout. Please try again.",
        variant: "destructive"
      });
    }
  });

  const promoMutation = useMutation({
    mutationFn: async ({ email, code }: { email: string; code: string }) => {
      const res = await fetch('/api/promo/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to redeem promo code');
      return data;
    },
    onSuccess: () => {
      localStorage.setItem(STORAGE_KEY, email);
      setCheckEmail(email);
      queryClient.invalidateQueries({ queryKey: ['/api/subscription-status'] });
      toast({
        title: "Success",
        description: "Promo code applied! You now have access.",
      });
    },
    onError: (err: Error) => {
      toast({
        title: "Invalid Code",
        description: err.message,
        variant: "destructive"
      });
    }
  });

  const handleSubscribe = () => {
    if (!email.trim() || !selectedPrice?.id) return;
    checkoutMutation.mutate({ email, priceId: selectedPrice.id });
  };

  const handleCheckAccess = () => {
    if (email.trim()) {
      localStorage.setItem(STORAGE_KEY, email);
      setCheckEmail(email);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem(STORAGE_KEY);
    setCheckEmail("");
    setEmail("");
  };

  const handleRedeemPromo = () => {
    if (!email.trim() || !promoCode.trim()) return;
    promoMutation.mutate({ email, code: promoCode });
  };

  if (checkingSubscription) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto mb-4" />
          <p className="text-muted-foreground">Checking subscription...</p>
        </div>
      </div>
    );
  }

  if (subscriptionData?.hasSubscription) {
    return <>{children}</>;
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-8 bg-background relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-background via-background to-primary/5 pointer-events-none" />
      <div className="absolute inset-0 opacity-30 pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/20 rounded-full blur-3xl animate-pulse" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-secondary/20 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }} />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative z-10 w-full max-w-md"
      >
        <Button 
          variant="ghost" 
          onClick={() => navigate('/')}
          className="mb-6"
          data-testid="button-back-home"
        >
          <ArrowLeft className="w-4 h-4 mr-2" /> Back to Home
        </Button>

        <div className="glass-panel rounded-2xl p-8 border border-secondary/30">
          <div className="text-center mb-6">
            <Crown className="w-16 h-16 text-secondary mx-auto mb-4" />
            <h1 className="font-display font-bold text-2xl mb-2">Subscription Required</h1>
            <p className="text-muted-foreground">
              Join Virtual Studio Pro to create and join recording sessions
            </p>
          </div>

          <div className="text-center mb-6">
            <p className="text-4xl font-bold">
              ${selectedPriceLabel}
              <span className="text-lg font-normal text-muted-foreground">
                /{billingInterval === "year" ? "year" : "month"}
              </span>
            </p>
            {billingInterval === "year" && (
              <p className="mt-1 text-xs text-muted-foreground">
                Billed yearly · ${(yearlyAmountCents / 1200).toFixed(2)}/month equivalent
              </p>
            )}
          </div>

          <div className="mb-5">
            <SubscriptionPlanSelector
              interval={billingInterval}
              onChange={setBillingInterval}
              monthlyAmountCents={monthlyAmountCents}
              yearlyAmountCents={yearlyAmountCents}
              yearlyCheckoutAvailable={!!yearlyPrice?.id}
            />
            {billingInterval === "year" && !yearlyPrice && (
              <p className="mt-2 text-xs text-amber-300" role="status">
                Yearly checkout needs an active $99 annual price in live Stripe.
              </p>
            )}
          </div>

          <div className="space-y-3 mb-6">
            <div className="flex items-center gap-2 text-sm">
              <Check className="w-4 h-4 text-secondary" />
              <span>Unlimited recording sessions</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <Check className="w-4 h-4 text-secondary" />
              <span>HD audio & video streaming</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <Check className="w-4 h-4 text-secondary" />
              <span>Cloud recording library</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <Check className="w-4 h-4 text-secondary" />
              <span>Cancel anytime</span>
            </div>
          </div>

          <div className="space-y-3">
            <Input
              type="email"
              placeholder="Enter your email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCheckAccess()}
              data-testid="input-gate-email"
              className="bg-background/50"
            />

            <Button 
              onClick={handleCheckAccess}
              disabled={!email.trim()}
              data-testid="button-check-access"
              className="w-full bg-gradient-to-r from-primary to-primary/80 hover:brightness-110"
            >
              <Check className="w-4 h-4 mr-2" />
              Check My Access
            </Button>

            {checkEmail && !subscriptionData?.hasSubscription && (
              <p className="text-sm text-center text-destructive mb-2">
                No active subscription found for {checkEmail}
              </p>
            )}

            <div className="relative my-4">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-white/10" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-card px-2 text-muted-foreground">New subscriber?</span>
              </div>
            </div>
            
            <Button 
              variant="outline"
              onClick={handleSubscribe}
              disabled={!email.trim() || checkoutMutation.isPending || !selectedPrice?.id}
              data-testid="button-gate-subscribe"
              className="w-full"
            >
              {checkoutMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : (
                <CreditCard className="w-4 h-4 mr-2" />
              )}
              {selectedPrice?.id
                ? `Subscribe - $${selectedPriceLabel}/${billingInterval === "year" ? "year" : "month"}`
                : "Yearly checkout unavailable"}
            </Button>

            <div className="relative my-4">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-white/10" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-card px-2 text-muted-foreground">Have a promo code?</span>
              </div>
            </div>

            {!showPromo ? (
              <Button 
                variant="ghost"
                onClick={() => setShowPromo(true)}
                data-testid="button-show-promo"
                className="w-full text-secondary hover:text-secondary/80"
              >
                <Gift className="w-4 h-4 mr-2" />
                Enter Promo Code
              </Button>
            ) : (
              <div className="space-y-2">
                <Input
                  type="text"
                  placeholder="Enter promo code"
                  value={promoCode}
                  onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
                  onKeyDown={(e) => e.key === 'Enter' && handleRedeemPromo()}
                  data-testid="input-promo-code"
                  className="bg-background/50 uppercase"
                />
                <Button 
                  onClick={handleRedeemPromo}
                  disabled={!email.trim() || !promoCode.trim() || promoMutation.isPending}
                  data-testid="button-redeem-promo"
                  className="w-full bg-gradient-to-r from-secondary to-secondary/80 hover:brightness-110"
                >
                  {promoMutation.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  ) : (
                    <Gift className="w-4 h-4 mr-2" />
                  )}
                  Redeem Code
                </Button>
              </div>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
}
