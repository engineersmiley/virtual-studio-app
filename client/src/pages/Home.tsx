import { useState } from "react";
import { useRecorder } from "@/hooks/use-recorder";
import { useUploadRecording } from "@/hooks/use-recordings";
import { Visualizer } from "@/components/Visualizer";
import { VolumeControl } from "@/components/VolumeControl";
import { Link } from "wouter";
import { Mic, Square, Disc, Save, Download, RotateCcw, ListMusic, AlertTriangle } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export default function Home() {
  const [title, setTitle] = useState("");
  const [isHighQuality, setIsHighQuality] = useState(false);
  const [sessionName, setSessionName] = useState("");
  const [sessionMode, setSessionMode] = useState(false);
  const uploadMutation = useUploadRecording();
  
  const {
    status,
    duration,
    error,
    blob,
    startRecording,
    stopRecording,
    resetRecorder,
    micVolume,
    setMicVolume,
    systemVolume,
    setSystemVolume,
    analyserNode,
    quality,
    setQuality
  } = useRecorder();

  const handleSave = async () => {
    if (!blob) return;
    try {
      await uploadMutation.mutateAsync({
        blob,
        metadata: {
          title: title || `${sessionMode ? sessionName : 'Recording'} ${new Date().toLocaleString()}`,
          duration,
          description: "Recorded via Web Studio",
          isHighQuality,
          sessionName: sessionMode ? sessionName : null
        }
      });
      resetRecorder();
      setTitle("");
    } catch (e) {
      console.error(e);
    }
  };

  const handleStart = () => {
    if (sessionMode && !sessionName) {
      setSessionName(`Session-${new Date().toISOString().split('T')[0]}`);
    }
    startRecording({ highQuality: isHighQuality });
  };

  const handleDownload = () => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `recording-${Date.now()}.webm`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const formattedTime = new Date(duration * 1000).toISOString().substr(11, 8);

  return (
    <div className="min-h-screen p-4 md:p-8 flex flex-col gap-8 max-w-7xl mx-auto">
      
      {/* Header */}
      <header className="flex justify-between items-center">
        <div>
          <h1 className="text-4xl font-display font-black text-transparent bg-clip-text bg-gradient-to-r from-primary via-white to-secondary drop-shadow-[0_0_10px_rgba(0,243,255,0.5)]">
            NEON CAPTURE
          </h1>
          <p className="text-muted-foreground font-tech uppercase tracking-widest text-sm mt-1">
            Professional Web Studio Recorder
          </p>
        </div>
        <Link href="/library" className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-card border border-white/10 hover:border-primary/50 hover:text-primary transition-all group shadow-lg">
          <span className="font-tech uppercase tracking-wider font-semibold text-sm">Library</span>
          <ListMusic size={18} className="group-hover:scale-110 transition-transform" />
        </Link>
      </header>

      {/* Main Studio Area */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-full flex-1">
        
        {/* Left Control Panel */}
        <div className="glass-panel rounded-2xl p-6 flex flex-col gap-6 lg:col-span-1 border-l-4 border-l-primary/50">
          <div className="flex items-center gap-3 pb-4 border-b border-white/10">
            <div className={`w-3 h-3 rounded-full ${status === 'recording' ? 'bg-red-500 animate-pulse shadow-[0_0_10px_red]' : 'bg-muted'}`} />
            <span className="font-tech text-xl font-bold tracking-widest text-white">
              {status === 'recording' ? 'REC' : status === 'stopped' ? 'FINISHED' : 'STANDBY'}
            </span>
            <div className="ml-auto font-mono text-xl text-primary text-glow-primary">
              {formattedTime}
            </div>
          </div>

          <div className="space-y-4">
            <VolumeControl 
              label="System Audio" 
              type="system" 
              value={systemVolume} 
              onChange={setSystemVolume} 
            />
            <VolumeControl 
              label="Microphone" 
              type="mic" 
              value={micVolume} 
              onChange={setMicVolume} 
            />
          </div>

          <div className="space-y-4 pt-4 border-t border-white/10">
            <div className="flex items-center justify-between">
              <span className="font-tech text-xs uppercase tracking-tighter text-muted-foreground">High Quality (WAV)</span>
              <input 
                type="checkbox" 
                checked={isHighQuality} 
                onChange={(e) => setIsHighQuality(e.target.checked)}
                className="accent-primary"
              />
            </div>
            <div className="flex items-center justify-between">
              <span className="font-tech text-xs uppercase tracking-tighter text-muted-foreground">Session Mode</span>
              <input 
                type="checkbox" 
                checked={sessionMode} 
                onChange={(e) => setSessionMode(e.target.checked)}
                className="accent-secondary"
              />
            </div>
            {sessionMode && (
              <input 
                type="text" 
                placeholder="Session Name..." 
                value={sessionName}
                onChange={(e) => setSessionName(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded bg-background/50 border border-white/10 outline-none text-white"
              />
            )}
          </div>

          <div className="mt-auto space-y-3">
            {error && (
              <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-sm flex items-center gap-2">
                <AlertTriangle size={16} />
                {error}
              </div>
            )}
            
            {status === 'idle' || status === 'stopped' ? (
              <button 
                onClick={handleStart}
                className="w-full py-4 rounded-xl bg-gradient-to-r from-primary to-primary/80 text-background font-display font-bold text-lg tracking-wider hover:brightness-110 active:scale-[0.98] transition-all shadow-[0_0_20px_-5px_hsl(var(--primary)/0.5)] flex items-center justify-center gap-2"
              >
                <Disc className="animate-spin-slow" /> START RECORDING
              </button>
            ) : (
              <button 
                onClick={stopRecording}
                className="w-full py-4 rounded-xl bg-destructive text-white font-display font-bold text-lg tracking-wider hover:bg-destructive/90 active:scale-[0.98] transition-all shadow-[0_0_20px_-5px_hsl(var(--destructive)/0.5)] flex items-center justify-center gap-2"
              >
                <Square fill="currentColor" /> STOP RECORDING
              </button>
            )}
          </div>
        </div>

        {/* Right Preview/Visualizer Panel */}
        <div className="glass-panel rounded-2xl p-6 lg:col-span-2 flex flex-col relative overflow-hidden border-r-4 border-r-secondary/50 min-h-[400px]">
          
          {/* Visualizer Area */}
          <div className="flex-1 rounded-xl overflow-hidden bg-black/50 relative group">
            {status === 'stopped' && blob ? (
              <video 
                src={URL.createObjectURL(blob)} 
                controls 
                className="w-full h-full object-contain"
              />
            ) : (
              <Visualizer analyser={analyserNode} status={status} />
            )}
            
            {/* Cyberpunk Overlay Lines */}
            <div className="absolute inset-0 pointer-events-none opacity-20 bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.25)_50%),linear-gradient(90deg,rgba(255,0,0,0.06),rgba(0,255,0,0.02),rgba(0,0,255,0.06))] z-10" style={{backgroundSize: "100% 2px, 3px 100%"}} />
          </div>

          {/* Post-Recording Actions */}
          <AnimatePresence>
            {status === 'stopped' && (
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 20 }}
                className="mt-6 flex flex-col sm:flex-row gap-4 items-center"
              >
                <div className="flex-1 w-full">
                  <input 
                    type="text" 
                    placeholder="Enter recording title..." 
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="w-full px-4 py-3 rounded-xl bg-background/50 border border-white/10 focus:border-primary focus:ring-1 focus:ring-primary outline-none text-white placeholder:text-muted-foreground transition-all"
                  />
                </div>
                
                <div className="flex gap-3 w-full sm:w-auto">
                  <button 
                    onClick={handleDownload}
                    className="flex-1 sm:flex-none px-4 py-3 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 text-white font-semibold flex items-center justify-center gap-2 transition-colors"
                  >
                    <Download size={18} /> Download
                  </button>
                  <button 
                    onClick={handleSave}
                    disabled={uploadMutation.isPending}
                    className="flex-1 sm:flex-none px-6 py-3 rounded-xl bg-secondary text-white font-semibold flex items-center justify-center gap-2 hover:bg-secondary/90 shadow-[0_0_15px_-3px_hsl(var(--secondary)/0.4)] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {uploadMutation.isPending ? (
                      <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : (
                      <Save size={18} />
                    )}
                    Save to Cloud
                  </button>
                  <button 
                    onClick={resetRecorder}
                    className="px-4 py-3 rounded-xl bg-white/5 border border-white/10 hover:text-destructive hover:border-destructive/50 transition-colors"
                    title="Discard & New"
                  >
                    <RotateCcw size={18} />
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
