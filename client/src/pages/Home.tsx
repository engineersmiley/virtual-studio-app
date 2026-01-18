import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { 
  Monitor, Mic, Users, Radio, ArrowRight, 
  Disc, ListMusic, Zap, Headphones, Eye, PenTool, Download
} from "lucide-react";
import { motion } from "framer-motion";
import { api } from "@shared/routes";
import type { SessionRole } from "@shared/schema";
import { usePwaInstall } from "@/hooks/use-pwa-install";

export default function Home() {
  const [, navigate] = useLocation();
  const [sessionName, setSessionName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [selectedRole, setSelectedRole] = useState<SessionRole>('artist');
  const { isInstallable, isInstalled, isIOSDevice, install } = usePwaInstall();
  const [showIOSInstructions, setShowIOSInstructions] = useState(false);

  // Create new session
  const createSession = useMutation({
    mutationFn: async (name: string) => {
      const res = await fetch(api.sessions.create.path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error('Failed to create session');
      return res.json();
    },
    onSuccess: (data) => {
      navigate(`/session/${data.id}/${selectedRole}`);
    },
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
          <div className="flex items-center justify-center gap-4 mb-6">
            <Radio className="w-12 h-12 text-primary animate-pulse" />
            <h1 className="text-5xl md:text-7xl font-display font-black text-transparent bg-clip-text bg-gradient-to-r from-primary via-white to-secondary">
              STUDIO LINK
            </h1>
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
