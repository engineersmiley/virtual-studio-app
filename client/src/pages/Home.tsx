import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { 
  Monitor, Mic, Users, Radio, ArrowRight, 
  Disc, ListMusic, Zap, Headphones
} from "lucide-react";
import { motion } from "framer-motion";
import { api } from "@shared/routes";

export default function Home() {
  const [, navigate] = useLocation();
  const [sessionName, setSessionName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [selectedRole, setSelectedRole] = useState<'artist' | 'engineer'>('artist');

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
              <h3 className="font-display font-bold text-lg mb-2">Screen Share</h3>
              <p className="text-sm text-muted-foreground">Share your DAW screen with your engineer in real-time</p>
            </div>
            <div className="glass-panel rounded-2xl p-6 text-left">
              <Headphones className="w-10 h-10 text-secondary mb-4" />
              <h3 className="font-display font-bold text-lg mb-2">System Audio</h3>
              <p className="text-sm text-muted-foreground">Capture system audio and microphone together</p>
            </div>
            <div className="glass-panel rounded-2xl p-6 text-left">
              <Disc className="w-10 h-10 text-primary mb-4" />
              <h3 className="font-display font-bold text-lg mb-2">Remote Record</h3>
              <p className="text-sm text-muted-foreground">Engineer records the session from anywhere</p>
            </div>
          </div>

          {/* Session Controls */}
          <div className="glass-panel rounded-2xl p-8 max-w-2xl mx-auto">
            {/* Role Selection */}
            <div className="flex gap-4 mb-8">
              <button
                onClick={() => setSelectedRole('artist')}
                className={`flex-1 py-4 rounded-xl font-display font-bold text-lg flex items-center justify-center gap-3 transition-all ${
                  selectedRole === 'artist' 
                    ? 'bg-secondary text-white shadow-[0_0_20px_-5px_hsl(var(--secondary)/0.5)]' 
                    : 'bg-white/5 border border-white/10 hover:border-secondary/50'
                }`}
              >
                <Mic size={24} /> I'm the Artist
              </button>
              <button
                onClick={() => setSelectedRole('engineer')}
                className={`flex-1 py-4 rounded-xl font-display font-bold text-lg flex items-center justify-center gap-3 transition-all ${
                  selectedRole === 'engineer' 
                    ? 'bg-primary text-background shadow-[0_0_20px_-5px_hsl(var(--primary)/0.5)]' 
                    : 'bg-white/5 border border-white/10 hover:border-primary/50'
                }`}
              >
                <Zap size={24} /> I'm the Engineer
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
                  className="w-full px-4 py-3 rounded-xl bg-background/50 border border-white/10 focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
                />
                <button
                  onClick={handleCreate}
                  disabled={createSession.isPending}
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
                  className="w-full px-4 py-3 rounded-xl bg-background/50 border border-white/10 focus:border-primary focus:ring-1 focus:ring-primary outline-none font-mono text-center text-2xl tracking-widest transition-all uppercase"
                />
                <button
                  onClick={handleJoin}
                  disabled={!joinCode.trim()}
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
      <footer className="p-6 flex justify-center gap-8 text-muted-foreground">
        <Link href="/library" className="flex items-center gap-2 hover:text-primary transition-colors">
          <ListMusic size={20} /> Recording Library
        </Link>
      </footer>
    </div>
  );
}
