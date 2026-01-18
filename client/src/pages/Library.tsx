import { useRecordings, useDeleteRecording } from "@/hooks/use-recordings";
import { RecordingCard } from "@/components/RecordingCard";
import { Link } from "wouter";
import { ArrowLeft, Search, Loader2 } from "lucide-react";
import { useState } from "react";

export default function Library() {
  const { data: recordings, isLoading, error } = useRecordings();
  const deleteMutation = useDeleteRecording();
  const [search, setSearch] = useState("");

  const filteredRecordings = recordings?.filter(rec => 
    rec.title.toLowerCase().includes(search.toLowerCase()) || 
    rec.sessionName?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="min-h-screen p-4 md:p-8 max-w-7xl mx-auto flex flex-col gap-8">
      {/* Header */}
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Link href="/" className="p-2 rounded-full bg-white/5 hover:bg-white/10 text-muted-foreground hover:text-primary transition-colors">
            <ArrowLeft size={24} />
          </Link>
          <div>
            <h1 className="text-3xl font-display font-bold text-white tracking-wider">
              RECORDING ARCHIVE
            </h1>
            <p className="text-muted-foreground font-tech text-sm mt-1">
              Manage your saved sessions
            </p>
          </div>
        </div>

        <div className="relative w-full md:w-80 group">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground group-focus-within:text-primary transition-colors" size={18} />
          <input 
            type="text" 
            placeholder="Search archives..." 
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-3 rounded-xl bg-card border border-white/10 focus:border-primary focus:ring-1 focus:ring-primary/50 outline-none transition-all placeholder:text-muted-foreground/50"
          />
        </div>
      </header>

      {/* Content Grid */}
      {isLoading ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="animate-spin text-primary w-12 h-12" />
        </div>
      ) : error ? (
        <div className="flex-1 flex items-center justify-center text-destructive">
          Error loading library
        </div>
      ) : filteredRecordings?.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-4">
          <div className="w-20 h-20 rounded-full bg-white/5 flex items-center justify-center">
            <Search size={40} className="opacity-20" />
          </div>
          <p>No recordings found in the archives.</p>
          {search && <button onClick={() => setSearch("")} className="text-primary hover:underline">Clear search</button>}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredRecordings?.map(rec => (
            <RecordingCard 
              key={rec.id} 
              recording={rec} 
              onDelete={(id) => {
                if(confirm("Permanently delete this recording?")) {
                  deleteMutation.mutate(id);
                }
              }}
              isDeleting={deleteMutation.isPending}
            />
          ))}
        </div>
      )}
    </div>
  );
}
