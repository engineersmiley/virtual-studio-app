import { Mic, Speaker, Monitor } from "lucide-react";

interface VolumeControlProps {
  label: string;
  value: number;
  onChange: (val: number) => void;
  type: 'mic' | 'system';
}

export function VolumeControl({ label, value, onChange, type }: VolumeControlProps) {
  return (
    <div className="flex flex-col gap-2 p-4 rounded-xl bg-card border border-border/50 backdrop-blur-sm">
      <div className="flex items-center gap-2 text-primary">
        {type === 'mic' ? <Mic size={18} /> : <Monitor size={18} />}
        <span className="font-tech uppercase tracking-wider text-sm font-semibold">{label}</span>
      </div>
      
      <div className="flex items-center gap-3">
        <input
          type="range"
          min="0"
          max="2"
          step="0.05"
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          className="w-full h-2 bg-muted rounded-full appearance-none cursor-pointer accent-primary"
        />
        <span className="font-tech text-xs w-12 text-right text-muted-foreground">
          {Math.round(value * 100)}%
        </span>
      </div>
    </div>
  );
}
