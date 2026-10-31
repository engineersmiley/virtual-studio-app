import { lazy, Suspense } from "react";
import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Home from "@/pages/Home";

// Keep the landing page eager; download the other pages only when visited.
const Library = lazy(() => import("@/pages/Library"));
const Session = lazy(() => import("@/pages/Session"));
const RemoteControl = lazy(() => import("@/pages/RemoteControl"));

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/library" component={Library} />
      <Route path="/session/:id/:role" component={Session} />
      <Route path="/remote-control" component={RemoteControl} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Suspense fallback={
          <div role="status" className="min-h-screen flex items-center justify-center text-muted-foreground">
            Loading page…
          </div>
        }>
          <Router />
        </Suspense>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
