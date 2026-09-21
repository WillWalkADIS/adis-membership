import { Switch, Route, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Join from "@/pages/join";
import Admin from "@/pages/admin";
import MembershipCard from "@/pages/card";
import VerifyMembership from "@/pages/verify";

function AppRouter() {
  return (
    <Switch>
      <Route path="/" component={Join} />
      <Route path="/admin" component={Admin} />
      <Route path="/card/:cardToken" component={MembershipCard} />
      <Route path="/verify/:token/:code" component={VerifyMembership} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router hook={useHashLocation}>
          <AppRouter />
        </Router>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
