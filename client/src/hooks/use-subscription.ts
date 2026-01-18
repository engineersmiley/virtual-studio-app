import { useQuery } from "@tanstack/react-query";

interface SubscriptionStatus {
  hasSubscription: boolean;
  status: string | null;
  email: string | null;
}

export function useSubscription(email: string | null) {
  return useQuery<SubscriptionStatus>({
    queryKey: ['/api/subscription-status', email],
    queryFn: async () => {
      if (!email) {
        return { hasSubscription: false, status: null, email: null };
      }
      const res = await fetch(`/api/subscription-status?email=${encodeURIComponent(email)}`);
      if (!res.ok) {
        return { hasSubscription: false, status: null, email: null };
      }
      return res.json();
    },
    enabled: !!email,
  });
}
