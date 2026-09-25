import { useEffect, useState } from "react";
import { useParams, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";
import { ShieldCheck, ArrowLeft, Clock } from "lucide-react";

import { AdisLogo } from "@/components/adis-logo";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { getApiBase } from "@/lib/queryClient";

interface CardData {
  primaryFullName: string;
  membershipNumber: string;
  membershipType: "single" | "family";
  paymentStatus: "pending" | "declared" | "paid" | "failed";
  membershipStartDate: string;
  membershipExpiryDate: string;
  otpCode: string;
  otpExpiresAt: number;
  otpPeriodSeconds: number;
}

function formatCountdown(msRemaining: number): string {
  const total = Math.max(0, Math.ceil(msRemaining / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function MembershipCard() {
  const { cardToken } = useParams<{ cardToken: string }>();

  const { data, isLoading, isError } = useQuery<CardData>({
    queryKey: [`/api/card/${cardToken}`],
    refetchInterval: 5000,
    retry: false,
  });

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  if (isLoading) {
    return (
      <div className="min-h-dvh bg-background flex items-center justify-center px-4">
        <Skeleton className="h-96 w-full max-w-sm rounded-2xl" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="min-h-dvh bg-background flex items-center justify-center px-4 text-center">
        <div>
          <p className="text-lg font-serif font-semibold text-foreground">Card not found</p>
          <p className="mt-1 text-sm text-muted-foreground">
            This membership card link is invalid. Please contact the ADIS committee.
          </p>
          <Link href="/" className="mt-4 inline-flex items-center gap-1.5 text-sm text-primary" data-testid="link-back-to-form-card">
            <ArrowLeft className="h-4 w-4" />
            Back to registration form
          </Link>
        </div>
      </div>
    );
  }

  const verifyUrl = `${window.location.origin}${window.location.pathname}#/verify/${cardToken}/${data.otpCode}`;
  const remainingMs = data.otpExpiresAt - now;
  const typeLabel = data.membershipType === "family" ? "Family Membership" : "Single Membership";
  const expiry = new Date(data.membershipExpiryDate).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

  // An expired membership must look expired and stop offering a QR code, so a
  // lapsed member is never turned away at the door by a card that looked fine.
  const hasExpired = new Date(data.membershipExpiryDate).getTime() < now;
  // "declared" means the member paid through the payment link and the
  // committee has not reconciled it yet — the membership is active either way.
  // Only a payment confirmed by the committee makes a card active.
  const isActive = data.paymentStatus === "paid";
  const statusLabel = hasExpired ? "Expired" : isActive ? "Active" : "Pending payment";

  return (
    <div className="min-h-dvh bg-background flex items-center justify-center px-4 py-10">
      <Card className="w-full max-w-sm overflow-hidden" data-testid="card-membership">
        <div className="bg-primary px-6 py-5 text-primary-foreground">
          <div className="flex items-center justify-between">
            <AdisLogo className="h-9 w-auto rounded bg-white/90 p-1" />
            <Badge
              variant={isActive && !hasExpired ? "default" : "secondary"}
              className="bg-white/15 text-primary-foreground border-white/20"
              data-testid="badge-card-payment-status"
            >
              {statusLabel}
            </Badge>
          </div>
        </div>

        <CardContent className="p-6">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Member</p>
          <h1 className="mt-0.5 text-xl font-serif font-semibold text-foreground" data-testid="text-card-name">
            {data.primaryFullName}
          </h1>

          <div className="mt-3 flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Membership #</span>
            <span className="font-medium text-foreground" data-testid="text-card-number">
              {data.membershipNumber}
            </span>
          </div>
          <div className="mt-1.5 flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Type</span>
            <span className="font-medium text-foreground">{typeLabel}</span>
          </div>
          <div className="mt-1.5 flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{hasExpired ? "Expired on" : "Valid until"}</span>
            <span className="font-medium text-foreground">{expiry}</span>
          </div>

          {hasExpired ? (
            <div className="mt-6 rounded-xl border border-border bg-muted/40 p-5 text-center">
              <p className="text-sm font-medium text-foreground">This membership has expired</p>
              <p className="mt-1.5 text-xs text-muted-foreground">
                Your card can no longer be used for entry. Renewing takes a couple of minutes and
                restores it straight away.
              </p>
              <Link
                href="/"
                className="mt-4 inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
                data-testid="link-renew-membership"
              >
                Renew my membership
              </Link>
            </div>
          ) : (
            <div className="mt-6 flex flex-col items-center rounded-xl border border-border bg-card p-5">
              <div className="rounded-lg bg-white p-3">
                <QRCodeSVG value={verifyUrl} size={168} data-testid="qr-membership-code" />
              </div>
              <div className="mt-3 flex items-center gap-1.5 text-sm font-medium text-foreground">
                <Clock className="h-3.5 w-3.5" />
                Refreshes in {formatCountdown(remainingMs)}
              </div>
              <p className="mt-2 text-center text-xs text-muted-foreground">
                This code changes every 5 minutes and is unique to this member. A screenshot or
                forwarded photo stops working after it refreshes — show this page live for entry.
              </p>
            </div>
          )}

          <div className="mt-4 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5" />
            Abu Dhabi Irish Society digital membership card
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
