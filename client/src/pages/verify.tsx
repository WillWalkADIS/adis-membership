import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "wouter";
import { CheckCircle2, XCircle, ArrowLeft } from "lucide-react";

import { AdisLogo } from "@/components/adis-logo";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getApiBase } from "@/lib/queryClient";

interface VerifyResult {
  valid: boolean;
  name?: string;
  membershipNumber?: string;
  membershipType?: "single" | "family";
  membershipExpiryDate?: string;
  message: string;
}

export default function VerifyMembership() {
  const { token = "", code = "" } = useParams<{ token: string; code: string }>();

  const { data, isLoading } = useQuery<VerifyResult>({
    queryKey: [`/api/verify?token=${encodeURIComponent(token)}&code=${encodeURIComponent(code)}`],
    queryFn: async () => {
      const res = await fetch(
        `${getApiBase()}/api/verify?token=${encodeURIComponent(token)}&code=${encodeURIComponent(code)}`,
      );
      return res.json();
    },
    enabled: Boolean(token && code),
  });

  return (
    <div className="min-h-dvh bg-background flex items-center justify-center px-4 py-10">
      <Card className="w-full max-w-sm">
        <CardContent className="p-6 text-center">
          <div className="flex justify-center">
            <AdisLogo className="h-9 w-auto" />
          </div>

          <div className="mt-6">
            {!token || !code ? (
              <>
                <XCircle className="mx-auto h-10 w-10 text-destructive" />
                <p className="mt-3 font-serif text-lg font-semibold text-foreground">No code provided</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Scan a member's live QR code to verify their ADIS membership.
                </p>
              </>
            ) : isLoading ? (
              <div className="space-y-3">
                <Skeleton className="mx-auto h-10 w-10 rounded-full" />
                <Skeleton className="h-5 w-40 mx-auto" />
                <Skeleton className="h-4 w-56 mx-auto" />
              </div>
            ) : data?.valid ? (
              <>
                <CheckCircle2 className="mx-auto h-10 w-10 text-primary" data-testid="icon-verify-valid" />
                <p className="mt-3 font-serif text-lg font-semibold text-foreground" data-testid="text-verify-name">
                  {data.name}
                </p>
                <p className="mt-1 text-sm text-muted-foreground" data-testid="text-verify-number">
                  {data.membershipNumber} &middot;{" "}
                  {data.membershipType === "family" ? "Family Membership" : "Single Membership"}
                </p>
                <p className="mt-3 text-sm font-medium text-primary">Valid ADIS membership</p>
              </>
            ) : (
              <>
                <XCircle className="mx-auto h-10 w-10 text-destructive" data-testid="icon-verify-invalid" />
                <p className="mt-3 font-serif text-lg font-semibold text-foreground">Not verified</p>
                <p className="mt-1 text-sm text-muted-foreground" data-testid="text-verify-message">
                  {data?.message ?? "This code could not be verified."}
                </p>
              </>
            )}
          </div>

          <Link
            href="/"
            className="mt-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
            data-testid="link-back-to-form-verify"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to registration form
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
