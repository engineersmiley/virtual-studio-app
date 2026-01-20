import { format } from "date-fns";
import { Play, Trash2, Download, HardDrive } from "lucide-react";
import type { Recording } from "@shared/schema";
import { useState } from "react";

interface RecordingCardProps {
  recording: Recording;
  onDelete: (id: number) => void;
  isDeleting: boolean;
}

export function RecordingCard({ recording, onDelete, isDeleting }: RecordingCardProps) {
  const [isPlaying, setIsPlaying] = useState(false);

  // Format bytes to MB
  const sizeMB = (recording.fileSize / (1024 * 1024)).toFixed(1);
  const formattedDuration = new Date(recording.duration * 1000).toISOString().substr(14, 5);

  return (
    <div className="group relative overflow-hidden rounded-xl border border-white/5 bg-card/40 backdrop-blur-sm hover:border-primary/50 hover:shadow-[0_0_20px_-5px_hsl(var(--primary)/0.3)] transition-all duration-300">
      
      {/* Decorative top bar */}
      <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-primary/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />

      <div className="p-5 flex flex-col gap-4">
        <div className="flex justify-between items-start">
          <div>
            <h3 className="font-display text-lg text-white group-hover:text-primary transition-colors truncate max-w-[200px]" title={recording.title}>
              {recording.title}
            </h3>
            <p className="text-xs text-muted-foreground mt-1 font-tech uppercase">
              {format(new Date(recording.createdAt || new Date()), "MMM d, yyyy • HH:mm")}
            </p>
          </div>
          <div className="px-2 py-1 rounded bg-secondary/10 text-secondary text-xs font-mono border border-secondary/20">
            {formattedDuration}
          </div>
        </div>

        {/* Info Grid */}
        <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <HardDrive size={12} />
            <span>{sizeMB} MB</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
            <span>Ready</span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between pt-2 border-t border-white/5">
          <button 
            className="p-2 rounded-lg bg-white/5 hover:bg-primary/20 hover:text-primary transition-colors"
            title="Preview (Not implemented fully in demo)"
          >
            <Play size={16} />
          </button>

          <div className="flex gap-2">
            <a 
              href={`/api/recordings/download/${recording.id}`} 
              target="_blank"
              rel="noreferrer"
              className="p-2 rounded-lg bg-white/5 hover:bg-secondary/20 hover:text-secondary transition-colors"
            >
              <Download size={16} />
            </a>
            
            <button
              onClick={() => onDelete(recording.id)}
              disabled={isDeleting}
              className="p-2 rounded-lg bg-white/5 hover:bg-destructive/20 hover:text-destructive transition-colors disabled:opacity-50"
            >
              <Trash2 size={16} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
