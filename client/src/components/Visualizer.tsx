import { useEffect, useRef } from 'react';

interface VisualizerProps {
  analyser: AnalyserNode | null;
  status: 'idle' | 'recording' | 'paused' | 'stopped';
  className?: string;
}

export function Visualizer({ analyser, status, className = "" }: VisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>();

  useEffect(() => {
    if (!canvasRef.current || !analyser || status !== 'recording') {
      // Clear canvas if idle
      if (canvasRef.current) {
        const ctx = canvasRef.current.getContext('2d');
        if (ctx) ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
      }
      return;
    }

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const draw = () => {
      animationRef.current = requestAnimationFrame(draw);
      analyser.getByteFrequencyData(dataArray);

      const width = canvas.width;
      const height = canvas.height;
      
      ctx.clearRect(0, 0, width, height);

      // Cyberpunk Grid Background
      ctx.strokeStyle = 'rgba(0, 243, 255, 0.1)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i < width; i += 20) {
        ctx.moveTo(i, 0);
        ctx.lineTo(i, height);
      }
      ctx.stroke();

      const barWidth = (width / bufferLength) * 2.5;
      let barHeight;
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        barHeight = dataArray[i] / 2; // Scale down

        // Gradient for bars (Cyan to Magenta)
        const gradient = ctx.createLinearGradient(0, height - barHeight, 0, height);
        gradient.addColorStop(0, '#00f3ff'); // Cyan top
        gradient.addColorStop(1, '#ff00ff'); // Magenta bottom

        ctx.fillStyle = gradient;
        
        // Add glow
        ctx.shadowBlur = 10;
        ctx.shadowColor = '#00f3ff';

        ctx.fillRect(x, height - barHeight, barWidth, barHeight);

        x += barWidth + 1;
      }
      
      // Reset shadow for next frame
      ctx.shadowBlur = 0;
    };

    draw();

    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [analyser, status]);

  return (
    <div className={`relative w-full h-full bg-black/40 rounded-xl overflow-hidden border border-white/10 ${className}`}>
      <canvas 
        ref={canvasRef} 
        width={600} 
        height={200} 
        className="w-full h-full"
      />
      {status === 'idle' && (
        <div className="absolute inset-0 flex items-center justify-center text-muted-foreground font-tech uppercase tracking-widest text-sm">
          Awaiting Audio Signal...
        </div>
      )}
    </div>
  );
}
