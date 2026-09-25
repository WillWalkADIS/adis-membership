import { useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Download, ArrowLeft, CheckCircle2, Clock, Users, LogOut, Lock } from "lucide-react";

import { AdisLogo } from "@/components/adis-logo";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, getApiBase, queryClient } from "@/lib/queryClient";

function AdminLogin() {
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const login = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/login", { email, password });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/me"] });
    },
    onError: () => {
      toast({ title: "Incorrect email or password", variant: "destructive" });
    },
  });

  return (
    <div className="min-h-dvh bg-background flex items-center justify-center px-4">
      <Card className="w-full max-w-sm">
        <CardContent className="p-6">
          <div className="mb-6 flex flex-col items-center gap-2 text-center">
            <AdisLogo className="h-10 w-auto" />
            <div className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
              <Lock className="h-3.5 w-3.5" />
              Committee Admin Login
            </div>
          </div>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              login.mutate();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="admin-email">Email</Label>
              <Input
                id="admin-email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                data-testid="input-admin-email"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="admin-password">Password</Label>
              <Input
                id="admin-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                data-testid="input-admin-password"
                required
              />
            </div>
            <Button type="submit" className="w-full" disabled={login.isPending} data-testid="button-admin-login">
              {login.isPending ? "Signing in…" : "Sign in"}
            </Button>
          </form>
          <Link
            href="/"
            className="mt-4 block text-center text-sm text-muted-foreground hover:text-foreground"
            data-testid="link-back-to-form-login"
          >
            Back to registration form
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}

interface RegistrationRow {
  id: number;
  membershipNumber: string;
  membershipType: "single" | "family";
  primaryFullName: string;
  primaryEmail: string;
  primaryMobile: string;
  secondAdultFirstName: string | null;
  secondAdultSurname: string | null;
  children: { firstName: string; surname: string; dob: string }[];
  memberStatus: "new" | "renewal";
  amountDue: number;
  paymentStatus: "pending" | "declared" | "paid" | "failed";
  paymentReference: string | null;
  registrationDate: string;
  membershipExpiryDate: string;
}

export default function Admin() {
  const { toast } = useToast();

  const { data: session, isLoading: isCheckingSession } = useQuery<{ email: string } | null>({
    queryKey: ["/api/admin/me"],
    queryFn: async () => {
      const res = await fetch(`${getApiBase()}/api/admin/me`);
      if (res.status === 401) return null;
      if (!res.ok) throw new Error("Failed to check session");
      return res.json();
    },
    retry: false,
  });

  const logout = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/admin/logout", {});
    },
    onSuccess: () => {
      queryClient.setQueryData(["/api/admin/me"], null);
      queryClient.removeQueries({ queryKey: ["/api/registrations"] });
    },
  });

  const { data, isLoading } = useQuery<RegistrationRow[]>({
    queryKey: ["/api/registrations"],
    enabled: !!session,
  });

  const markPaid = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("PATCH", `/api/registrations/${id}/mark-paid`, {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/registrations"] });
      toast({ title: "Payment recorded" });
    },
    onError: () => {
      toast({ title: "Could not update payment status", variant: "destructive" });
    },
  });

  const unmarkPaid = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("PATCH", `/api/registrations/${id}/unmark-paid`, {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/registrations"] });
      toast({ title: "Moved back to Paid — to verify" });
    },
    onError: () => {
      toast({ title: "Could not update payment status", variant: "destructive" });
    },
  });

  const remove = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("DELETE", `/api/registrations/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/registrations"] });
      toast({ title: "Registration deleted" });
    },
    onError: () => {
      toast({ title: "Could not delete the registration", variant: "destructive" });
    },
  });

  const registrations = data ?? [];
  const totalMembers = registrations.length;
  const paidCount = registrations.filter((r) => r.paymentStatus === "paid").length;
  // Paid through the payment link, not yet matched against the payment
  // dashboard by a committee member.
  const toVerifyCount = registrations.filter((r) => r.paymentStatus === "declared").length;
  const pendingCount = totalMembers - paidCount - toVerifyCount;

  if (isCheckingSession) {
    return (
      <div className="min-h-dvh bg-background flex items-center justify-center">
        <Skeleton className="h-10 w-40" />
      </div>
    );
  }

  if (!session) {
    return <AdminLogin />;
  }

  return (
    <div className="min-h-dvh bg-background">
      <header className="border-b border-border">
        <div className="mx-auto max-w-6xl px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <AdisLogo className="h-9 w-auto" />
            <span className="text-sm font-medium text-muted-foreground">Committee Admin</span>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/" className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground" data-testid="link-back-to-form">
              <ArrowLeft className="h-4 w-4" />
              Back to registration form
            </Link>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => logout.mutate()}
              disabled={logout.isPending}
              data-testid="button-admin-logout"
            >
              <LogOut className="h-4 w-4 mr-1.5" />
              Log out
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold font-serif text-foreground">Membership Database</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Every online registration is recorded here automatically.
            </p>
          </div>
          <a
            href={`${getApiBase()}/api/registrations/export.csv`}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="link-export-csv"
          >
            <Button variant="outline">
              <Download className="h-4 w-4 mr-1.5" />
              Export to CSV
            </Button>
          </a>
        </div>

        <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard icon={Users} label="Total registrations" value={totalMembers} testId="stat-total" />
          <StatCard icon={CheckCircle2} label="Verified paid" value={paidCount} testId="stat-paid" />
          <StatCard icon={Clock} label="Paid — to verify" value={toVerifyCount} testId="stat-to-verify" />
          <StatCard icon={Clock} label="No payment yet" value={pendingCount} testId="stat-pending" />
        </div>

        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="space-y-3 p-6">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
              </div>
            ) : registrations.length === 0 ? (
              <div className="p-10 text-center text-sm text-muted-foreground" data-testid="text-empty-state">
                No registrations yet. Once members join via the form, they'll appear here.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Membership #</TableHead>
                      <TableHead>Primary Member</TableHead>
                      <TableHead>Second Adult</TableHead>
                      <TableHead>Contact</TableHead>
                      <TableHead>Children</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>New/Renewal</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Payment &amp; actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {registrations.map((r) => (
                      <TableRow key={r.id} data-testid={`row-registration-${r.id}`}>
                        <TableCell className="font-medium">
                          {r.membershipNumber}
                          <div className="mt-1 whitespace-nowrap text-xs font-normal text-muted-foreground">
                            {new Date(r.registrationDate).toLocaleDateString("en-GB")}
                          </div>
                        </TableCell>
                        <TableCell>{r.primaryFullName}</TableCell>
                        <TableCell>
                          {r.secondAdultFirstName ? `${r.secondAdultFirstName} ${r.secondAdultSurname ?? ""}` : "—"}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                          <div>{r.primaryEmail}</div>
                          <div>{r.primaryMobile}</div>
                        </TableCell>
                        <TableCell>{r.children?.length ?? 0}</TableCell>
                        <TableCell className="capitalize">{r.membershipType}</TableCell>
                        <TableCell className="capitalize">{r.memberStatus}</TableCell>
                        <TableCell>AED {r.amountDue}</TableCell>
                        <TableCell>
                          <Badge
                            variant={r.paymentStatus === "paid" ? "default" : "secondary"}
                            data-testid={`badge-payment-status-${r.id}`}
                          >
                            {r.paymentStatus === "declared" ? "paid — to verify" : r.paymentStatus}
                          </Badge>
                          {r.paymentReference ? (
                            <div className="mt-1 text-xs text-muted-foreground">
                              Ref: {r.paymentReference}
                            </div>
                          ) : null}
                          <div className="mt-2 flex flex-col items-start gap-1">
                            {r.paymentStatus !== "paid" && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => markPaid.mutate(r.id)}
                                disabled={markPaid.isPending}
                                data-testid={`button-mark-paid-${r.id}`}
                              >
                                {r.paymentStatus === "declared" ? "Confirm paid & send card" : "Mark paid & send card"}
                              </Button>
                            )}
                            {r.paymentStatus === "paid" && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  if (
                                    window.confirm(
                                      `Move ${r.membershipNumber} back to "Paid — to verify"? Their card will not scan at the door until you confirm them again.`,
                                    )
                                  ) {
                                    unmarkPaid.mutate(r.id);
                                  }
                                }}
                                disabled={unmarkPaid.isPending}
                                data-testid={`button-unmark-paid-${r.id}`}
                              >
                                Undo paid
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-destructive"
                              onClick={() => {
                                if (
                                  window.confirm(
                                    `Delete ${r.membershipNumber} (${r.primaryFullName})? This cannot be undone and their card will stop working.`,
                                  )
                                ) {
                                  remove.mutate(r.id);
                                }
                              }}
                              disabled={remove.isPending}
                              data-testid={`button-delete-${r.id}`}
                            >
                              Delete
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <p className="mt-4 text-xs text-muted-foreground">
          "Paid — to verify" means the member ticked that they paid through the payment link. Check it against
          the PRJCT Abu Dhabi payment dashboard, then click "Confirm paid & send card". Membership cards are only
          ever emailed at that moment — to both adults on a Family membership. Use "Mark paid & send card" for cash
          or bank transfers.
        </p>
      </main>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  testId,
}: {
  icon: typeof Users;
  label: string;
  value: number;
  testId: string;
}) {
  return (
    <Card data-testid={testId}>
      <CardContent className="p-4 flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent">
          <Icon className="h-4.5 w-4.5 text-primary" />
        </div>
        <div>
          <div className="text-xs text-muted-foreground">{label}</div>
          <div className="text-lg font-semibold font-serif text-foreground">{value}</div>
        </div>
      </CardContent>
    </Card>
  );
}
