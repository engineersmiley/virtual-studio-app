import { useState, useEffect } from "react";
import { useLocation, useSearch } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { 
  Monitor, Mic, Users, ArrowRight, 
  Disc, ListMusic, Zap, Headphones, Eye, PenTool, Download,
  Crown, Check, CreditCard, Loader2
} from "lucide-react";
import logoImage from "@assets/generated_images/virtual_studio_logo_with_globe.png";
import { motion } from "framer-motion";
import { api } from "@shared/routes";
import type { SessionRole } from "@shared/schema";
import { usePwaInstall } from "@/hooks/use-pwa-install";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

export default function Home() {
  const [, navigate] = useLocation();
  const searchString = useSearch();
  const [sessionName, setSessionName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [selectedRole, setSelectedRole] = useState<SessionRole>('artist');
  const { isInstallable, isInstalled, isIOSDevice, install } = usePwaInstall();
  const [showIOSInstructions, setShowIOSInstructions] = useState(false);
  const [email, setEmail] = useState("");
  const [showSubscribe, setShowSubscribe] = useState(false);
  const { toast } = useToast();

  const justSubscribed = searchString.includes('subscribed=true');
  const cancelled = searchString.includes('cancelled=true');

  useEffect(() => {
    if (justSubscribed) {
      toast({
        title: "Welcome to Virtual Studio Pro!",
        description: "Thank you for subscribing. Enjoy unlimited sessions!",
      });
    }
    if (cancelled) {
      toast({
        title: "Subscription cancelled",
        description: "You can subscribe anytime.",
        variant: "destructive"
      });
    }
  }, [justSubscribed, cancelled]);

  const { data: pricesData } = useQuery<{ prices: Array<{ id: string; unit_amount: number; currency: string }> }>({
    queryKey: ['/api/stripe/prices'],
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

  const handleSubscribe = () => {
    if (!email.trim() || !pricesData?.prices?.[0]?.id) return;
    checkoutMutation.mutate({ email, priceId: pricesData.prices[0].id });
  };

  const monthlyPrice = pricesData?.prices?.[0];
  const priceAmount = monthlyPrice?.unit_amount ? (monthlyPrice.unit_amount / 100).toFixed(2) : '9.99';

  // Create new session
  const createSession = useMutation({
    mutationFn: async (name: string) => {
      const subscriberEmail = localStorage.getItem('studiolink_subscriber_email');
      const res = await fetch(api.sessions.create.path, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          ...(subscriberEmail && { 'X-Subscriber-Email': subscriberEmail })
        },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({ message: 'Failed to create session' }));
        throw new Error(error.message || 'Failed to create session');
      }
      return res.json();
    },
    onSuccess: (data) => {
      navigate(`/session/${data.id}/${selectedRole}`);
    },
    onError: (error: Error) => {
      if (error.message.includes('subscription')) {
        toast({
          title: "Subscription Required",
          description: "Please subscribe to create recording sessions.",
          variant: "destructive"
        });
      }
    }
  });

  const handleCreate = () => {
    const name = sessionName || `Session ${new Date().toLocaleDateString()}`;
    createSession.mutate(name);
  };

  const handleJoin = () => {
    if (joinCode.trim()) {
      navigate(`/session/${joinCode.toUpperCase()}/${selectedRole}`);
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      {/* Hero Section */}
      <div className="flex-1 flex flex-col items-center justify-center p-8 relative overflow-hidden">
        {/* Animated background */}
        <div className="absolute inset-0 bg-gradient-to-br from-background via-background to-primary/5" />
        <div className="absolute inset-0 opacity-30">
          <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/20 rounded-full blur-3xl animate-pulse" />
          <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-secondary/20 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }} />
        </div>

        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="relative z-10 text-center max-w-4xl mx-auto"
        >
          <div className="flex items-center justify-center mb-6">
            <img src={logoImage} alt="Virtual Studio" className="h-24 md:h-32 w-auto" />
          </div>
          
          <p className="text-xl text-muted-foreground font-tech uppercase tracking-widest mb-12">
            Remote Music Recording Collaboration
          </p>

          {/* Feature Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
            <div className="glass-panel rounded-2xl p-6 text-left">
              <Monitor className="w-10 h-10 text-primary mb-4" />
              <h3 className="font-display font-bold text-lg mb-2">Virtual Recording</h3>
              <p className="text-sm text-muted-foreground">Capture your creative vision in stunning clarity</p>
            </div>
            <div className="glass-panel rounded-2xl p-6 text-left">
              <Headphones className="w-10 h-10 text-secondary mb-4" />
              <h3 className="font-display font-bold text-lg mb-2">Global Connect</h3>
              <p className="text-sm text-muted-foreground">Collaborate with your team from anywhere in the world</p>
            </div>
            <div className="glass-panel rounded-2xl p-6 text-left">
              <Disc className="w-10 h-10 text-primary mb-4" />
              <h3 className="font-display font-bold text-lg mb-2">Instant Capture</h3>
              <p className="text-sm text-muted-foreground">Never miss a moment of creative inspiration</p>
            </div>
          </div>

          {/* Pro Subscription Banner */}
          {!showSubscribe ? (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="glass-panel rounded-2xl p-6 mb-8 max-w-2xl mx-auto border border-secondary/30"
            >
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-3">
                  <Crown className="w-8 h-8 text-secondary" />
                  <div className="text-left">
                    <h3 className="font-display font-bold text-lg">Virtual Studio Pro</h3>
                    <p className="text-sm text-muted-foreground">
                      Unlimited sessions for ${priceAmount}/month
                    </p>
                  </div>
                </div>
                <Button 
                  onClick={() => setShowSubscribe(true)}
                  data-testid="button-get-pro"
                  className="bg-gradient-to-r from-secondary to-secondary/80 hover:brightness-110"
                >
                  Get Pro <ArrowRight className="ml-2 w-4 h-4" />
                </Button>
              </div>
            </motion.div>
          ) : (
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="glass-panel rounded-2xl p-6 mb-8 max-w-md mx-auto border border-secondary/50"
            >
              <div className="text-center mb-6">
                <Crown className="w-12 h-12 text-secondary mx-auto mb-3" />
                <h3 className="font-display font-bold text-2xl mb-2">Virtual Studio Pro</h3>
                <p className="text-3xl font-bold">
                  ${priceAmount}
                  <span className="text-sm font-normal text-muted-foreground">/month</span>
                </p>
              </div>

              <div className="space-y-3 mb-6 text-left">
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
                  <span>Priority support</span>
                </div>
              </div>

              <div className="space-y-3">
                <Input
                  type="email"
                  placeholder="Enter your email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  data-testid="input-subscription-email"
                  className="bg-background/50"
                />
                <Button 
                  onClick={handleSubscribe}
                  disabled={!email.trim() || checkoutMutation.isPending}
                  data-testid="button-subscribe"
                  className="w-full bg-gradient-to-r from-secondary to-secondary/80 hover:brightness-110"
                >
                  {checkoutMutation.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  ) : (
                    <CreditCard className="w-4 h-4 mr-2" />
                  )}
                  Subscribe Now
                </Button>
                <button
                  onClick={() => setShowSubscribe(false)}
                  className="text-sm text-muted-foreground hover:text-foreground transition-colors w-full"
                >
                  Maybe later
                </button>
              </div>
            </motion.div>
          )}

          {/* Session Controls */}
          <div className="glass-panel rounded-2xl p-8 max-w-2xl mx-auto">
            {/* Role Selection */}
            <div className="grid grid-cols-2 gap-3 mb-8">
              <button
                onClick={() => setSelectedRole('artist')}
                data-testid="button-role-artist"
                className={`py-4 rounded-xl font-display font-bold text-base flex items-center justify-center gap-2 transition-all ${
                  selectedRole === 'artist' 
                    ? 'bg-secondary text-white shadow-[0_0_20px_-5px_hsl(var(--secondary)/0.5)]' 
                    : 'bg-white/5 border border-white/10 hover:border-secondary/50'
                }`}
              >
                <Mic size={20} /> Artist
              </button>
              <button
                onClick={() => setSelectedRole('engineer')}
                data-testid="button-role-engineer"
                className={`py-4 rounded-xl font-display font-bold text-base flex items-center justify-center gap-2 transition-all ${
                  selectedRole === 'engineer' 
                    ? 'bg-primary text-background shadow-[0_0_20px_-5px_hsl(var(--primary)/0.5)]' 
                    : 'bg-white/5 border border-white/10 hover:border-primary/50'
                }`}
              >
                <Zap size={20} /> Engineer
              </button>
              <button
                onClick={() => setSelectedRole('producer')}
                data-testid="button-role-producer"
                className={`py-4 rounded-xl font-display font-bold text-base flex items-center justify-center gap-2 transition-all ${
                  selectedRole === 'producer' 
                    ? 'bg-purple-600 text-white shadow-[0_0_20px_-5px_rgba(147,51,234,0.5)]' 
                    : 'bg-white/5 border border-white/10 hover:border-purple-500/50'
                }`}
              >
                <Eye size={20} /> Producer
              </button>
              <button
                onClick={() => setSelectedRole('other')}
                data-testid="button-role-other"
                className={`py-4 rounded-xl font-display font-bold text-base flex items-center justify-center gap-2 transition-all ${
                  selectedRole === 'other' 
                    ? 'bg-amber-600 text-white shadow-[0_0_20px_-5px_rgba(217,119,6,0.5)]' 
                    : 'bg-white/5 border border-white/10 hover:border-amber-500/50'
                }`}
              >
                <PenTool size={20} /> Other
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Create New Session */}
              <div className="space-y-4">
                <h3 className="font-tech uppercase tracking-wider text-muted-foreground text-sm">Create New Session</h3>
                <input
                  type="text"
                  placeholder="Session name (optional)"
                  value={sessionName}
                  onChange={(e) => setSessionName(e.target.value)}
                  data-testid="input-session-name"
                  className="w-full px-4 py-3 rounded-xl bg-background/50 border border-white/10 focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
                />
                <button
                  onClick={handleCreate}
                  disabled={createSession.isPending}
                  data-testid="button-create-session"
                  className="w-full py-4 rounded-xl bg-gradient-to-r from-primary to-secondary text-background font-display font-bold text-lg flex items-center justify-center gap-2 hover:brightness-110 active:scale-[0.98] transition-all disabled:opacity-50"
                >
                  {createSession.isPending ? (
                    <div className="w-5 h-5 border-2 border-background/30 border-t-background rounded-full animate-spin" />
                  ) : (
                    <>Create Session <ArrowRight size={20} /></>
                  )}
                </button>
              </div>

              {/* Join Existing Session */}
              <div className="space-y-4">
                <h3 className="font-tech uppercase tracking-wider text-muted-foreground text-sm">Join Existing Session</h3>
                <input
                  type="text"
                  placeholder="Enter room code"
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                  maxLength={6}
                  data-testid="input-room-code"
                  className="w-full px-4 py-3 rounded-xl bg-background/50 border border-white/10 focus:border-primary focus:ring-1 focus:ring-primary outline-none font-mono text-center text-2xl tracking-widest transition-all uppercase"
                />
                <button
                  onClick={handleJoin}
                  disabled={!joinCode.trim()}
                  data-testid="button-join-session"
                  className="w-full py-4 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 font-display font-bold text-lg flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Users size={20} /> Join Session
                </button>
              </div>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Footer */}
      <footer className="p-6 flex flex-col items-center gap-4 text-muted-foreground">
        <div className="flex justify-center gap-8">
          <Link href="/library" className="flex items-center gap-2 hover:text-primary transition-colors">
            <ListMusic size={20} /> Recording Library
          </Link>
          {isInstallable && !isInstalled && !isIOSDevice && (
            <button
              onClick={install}
              data-testid="button-install-app"
              className="flex items-center gap-2 hover:text-primary transition-colors"
            >
              <Download size={20} /> Install App
            </button>
          )}
          {isInstallable && !isInstalled && isIOSDevice && (
            <button
              onClick={() => setShowIOSInstructions(!showIOSInstructions)}
              data-testid="button-install-app-ios"
              className="flex items-center gap-2 hover:text-primary transition-colors"
            >
              <Download size={20} /> Install App
            </button>
          )}
          {isInstalled && (
            <span className="flex items-center gap-2 text-primary">
              <Download size={20} /> App Installed
            </span>
          )}
        </div>
        {showIOSInstructions && isIOSDevice && (
          <div className="glass-panel rounded-xl p-4 text-center max-w-sm">
            <p className="text-sm mb-2">To install on iOS:</p>
            <ol className="text-xs text-left space-y-1">
              <li>1. Tap the Share button in Safari</li>
              <li>2. Scroll down and tap "Add to Home Screen"</li>
              <li>3. Tap "Add" in the top right</li>
            </ol>
          </div>
        )}
      </footer>
    </div>
  );
}
