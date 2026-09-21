import { useState } from "react";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Link } from "wouter";
import { CheckCircle2, Plus, Trash2, Users, User, ShieldCheck, ArrowLeft, ArrowRight, Loader2 } from "lucide-react";

import { AdisLogo } from "@/components/adis-logo";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  joinFormSchema,
  EMIRATES,
  MEMBERSHIP_FEES,
  type JoinFormValues,
} from "@/lib/form-schema";

const STEPS = ["Membership", "Your Details", "Family", "Preferences", "Review & Pay"];

type SuccessInfo = {
  membershipNumber: string;
  primaryFullName: string;
  membershipType: "single" | "family";
  amountDue: number;
  registrationDate: string;
  membershipExpiryDate: string;
  cardEmailSent: boolean;
};

export default function Join() {
  const { toast } = useToast();
  const [stepIndex, setStepIndex] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<SuccessInfo | null>(null);

  const form = useForm<JoinFormValues>({
    resolver: zodResolver(joinFormSchema),
    defaultValues: {
      membershipType: undefined as unknown as "single" | "family",
      primaryFullName: "",
      primaryEmail: "",
      primaryMobile: "",
      nationality: "",
      emirate: "",
      memberStatus: "new",
      previousMember: false,
      secondAdultFirstName: "",
      secondAdultSurname: "",
      secondAdultEmail: "",
      secondAdultMobile: "",
      children: [],
      communicationPreference: undefined as unknown as "email" | "whatsapp" | "both",
      joinWhatsappCommunity: false,
      receiveMarketing: false,
      consentTerms: false,
      consentPrivacy: false,
    },
    mode: "onTouched",
  });

  const { fields: childFields, append: appendChild, remove: removeChild } = useFieldArray({
    control: form.control,
    name: "children",
  });

  const membershipType = form.watch("membershipType");
  const isFamily = membershipType === "family";

  // Steps are dynamic: skip the "Family" step entirely for single memberships.
  const visibleSteps = isFamily ? STEPS : STEPS.filter((s) => s !== "Family");
  const currentStepLabel = visibleSteps[stepIndex];

  const amountDue = membershipType ? MEMBERSHIP_FEES[membershipType] : 0;

  async function goNext() {
    const fieldsByStep: Record<string, (keyof JoinFormValues)[]> = {
      Membership: ["membershipType"],
      "Your Details": [
        "primaryFullName",
        "primaryEmail",
        "primaryMobile",
        "nationality",
        "emirate",
        "memberStatus",
      ],
      Family: ["secondAdultFirstName", "secondAdultSurname"],
      Preferences: ["communicationPreference", "consentTerms", "consentPrivacy"],
    };
    const fields = fieldsByStep[currentStepLabel];
    if (fields) {
      const valid = await form.trigger(fields as any);
      if (!valid) return;
    }
    setStepIndex((i) => Math.min(i + 1, visibleSteps.length - 1));
  }

  function goBack() {
    setStepIndex((i) => Math.max(i - 1, 0));
  }

  async function onSubmit(values: JoinFormValues) {
    setSubmitting(true);
    try {
      const payload = {
        ...values,
        amountDue: MEMBERSHIP_FEES[values.membershipType],
        children: isFamily ? values.children : [],
        secondAdultFirstName: isFamily ? values.secondAdultFirstName : "",
        secondAdultSurname: isFamily ? values.secondAdultSurname : "",
        secondAdultEmail: isFamily ? values.secondAdultEmail : "",
        secondAdultMobile: isFamily ? values.secondAdultMobile : "",
      };
      const res = await apiRequest("POST", "/api/registrations", payload);
      const registration = await res.json();
      setSuccess({
        membershipNumber: registration.membershipNumber,
        primaryFullName: registration.primaryFullName,
        membershipType: registration.membershipType,
        amountDue: registration.amountDue,
        registrationDate: registration.registrationDate,
        membershipExpiryDate: registration.membershipExpiryDate,
        cardEmailSent: Boolean(registration.cardEmailSent),
      });
    } catch (err) {
      toast({
        title: "Something went wrong",
        description: "We couldn't submit your registration. Please try again.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  }

  if (success) {
    return <SuccessScreen info={success} />;
  }

  return (
    <div className="min-h-dvh bg-background">
      <header className="border-b border-border">
        <div className="mx-auto max-w-2xl px-4 py-4 flex items-center justify-between">
          <AdisLogo className="h-10 w-auto" />
          <Link
            href="/admin"
            className="text-xs text-muted-foreground hover:text-foreground"
            data-testid="link-admin"
          >
            Committee Admin
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-8 pb-24">
        <div className="mb-8 text-center">
          <h1 className="text-xl font-semibold font-serif text-foreground" data-testid="text-page-title">
            Join or Renew Your ADIS Membership
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Complete the form below to become part of the Abu Dhabi Irish Society community.
          </p>
        </div>

        <Stepper steps={visibleSteps} currentIndex={stepIndex} />

        <Card className="mt-6" data-testid="card-form">
          <CardContent className="p-6">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (stepIndex === visibleSteps.length - 1) {
                  form.handleSubmit(onSubmit)(e);
                } else {
                  goNext();
                }
              }}
              className="space-y-6"
            >
              {currentStepLabel === "Membership" && (
                <MembershipStep form={form} />
              )}
              {currentStepLabel === "Your Details" && (
                <PrimaryDetailsStep form={form} />
              )}
              {currentStepLabel === "Family" && (
                <FamilyStep
                  form={form}
                  childFields={childFields}
                  appendChild={appendChild}
                  removeChild={removeChild}
                />
              )}
              {currentStepLabel === "Preferences" && (
                <PreferencesStep form={form} />
              )}
              {currentStepLabel === "Review & Pay" && (
                <ReviewStep form={form} isFamily={isFamily} amountDue={amountDue} />
              )}

              <div className="flex items-center justify-between pt-2">
                {stepIndex > 0 ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={goBack}
                    data-testid="button-back"
                  >
                    <ArrowLeft className="h-4 w-4 mr-1.5" />
                    Back
                  </Button>
                ) : (
                  <span />
                )}

                {stepIndex < visibleSteps.length - 1 ? (
                  <Button type="submit" data-testid="button-continue">
                    Continue
                    <ArrowRight className="h-4 w-4 ml-1.5" />
                  </Button>
                ) : (
                  <Button type="submit" disabled={submitting} data-testid="button-submit-registration">
                    {submitting ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                        Processing...
                      </>
                    ) : (
                      "JOIN ADIS & PAY MEMBERSHIP"
                    )}
                  </Button>
                )}
              </div>
            </form>
          </CardContent>
        </Card>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Questions about your membership? Contact the ADIS committee via the WhatsApp Community or ADIS social
          channels.
        </p>
      </main>
    </div>
  );
}

function Stepper({ steps, currentIndex }: { steps: string[]; currentIndex: number }) {
  return (
    <ol className="flex items-center gap-1.5" data-testid="stepper">
      {steps.map((label, i) => (
        <li key={label} className="flex flex-1 items-center gap-1.5">
          <div
            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-medium ${
              i < currentIndex
                ? "bg-primary text-primary-foreground"
                : i === currentIndex
                ? "bg-primary text-primary-foreground ring-2 ring-primary/30"
                : "bg-muted text-muted-foreground"
            }`}
            data-testid={`step-indicator-${i}`}
          >
            {i < currentIndex ? <CheckCircle2 className="h-4 w-4" /> : i + 1}
          </div>
          {i < steps.length - 1 && (
            <div className={`h-0.5 flex-1 rounded ${i < currentIndex ? "bg-primary" : "bg-muted"}`} />
          )}
        </li>
      ))}
    </ol>
  );
}

function StepHeading({ title, description }: { title: string; description?: string }) {
  return (
    <div>
      <h2 className="text-lg font-semibold font-serif text-foreground">{title}</h2>
      {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
    </div>
  );
}

function MembershipStep({ form }: { form: ReturnType<typeof useForm<JoinFormValues>> }) {
  const value = form.watch("membershipType");
  return (
    <div className="space-y-4">
      <StepHeading title="Select Your Membership" description="Please select your membership type below." />
      <RadioGroup
        value={value}
        onValueChange={(v) => form.setValue("membershipType", v as "single" | "family", { shouldValidate: true })}
        className="grid gap-3 sm:grid-cols-2"
      >
        <label
          htmlFor="membership-single"
          className={`flex cursor-pointer flex-col gap-2 rounded-lg border p-4 transition-colors ${
            value === "single" ? "border-primary bg-accent" : "border-border"
          }`}
          data-testid="option-membership-single"
        >
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 font-medium text-foreground">
              <User className="h-4 w-4 text-primary" />
              Single Membership
            </span>
            <RadioGroupItem value="single" id="membership-single" />
          </div>
          <span className="text-lg font-semibold font-serif text-primary">AED 100</span>
          <span className="text-sm text-muted-foreground">Membership for one adult.</span>
        </label>

        <label
          htmlFor="membership-family"
          className={`flex cursor-pointer flex-col gap-2 rounded-lg border p-4 transition-colors ${
            value === "family" ? "border-primary bg-accent" : "border-border"
          }`}
          data-testid="option-membership-family"
        >
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 font-medium text-foreground">
              <Users className="h-4 w-4 text-primary" />
              Family Membership
            </span>
            <RadioGroupItem value="family" id="membership-family" />
          </div>
          <span className="text-lg font-semibold font-serif text-primary">AED 200</span>
          <span className="text-sm text-muted-foreground">
            For two adults/parents/guardians and their dependent children.
          </span>
        </label>
      </RadioGroup>
      {form.formState.errors.membershipType && (
        <p className="text-sm text-destructive" data-testid="error-membership-type">
          {form.formState.errors.membershipType.message}
        </p>
      )}
    </div>
  );
}

function Field({
  label,
  error,
  children,
  htmlFor,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
  htmlFor: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

function PrimaryDetailsStep({ form }: { form: ReturnType<typeof useForm<JoinFormValues>> }) {
  const { register, formState, watch, setValue } = form;
  const errors = formState.errors;
  return (
    <div className="space-y-4">
      <StepHeading title="Primary Member Details" description="Tell us about the primary member." />

      <Field label="Full name" htmlFor="primaryFullName" error={errors.primaryFullName?.message}>
        <Input id="primaryFullName" data-testid="input-primary-full-name" {...register("primaryFullName")} />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Email address" htmlFor="primaryEmail" error={errors.primaryEmail?.message}>
          <Input id="primaryEmail" type="email" data-testid="input-primary-email" {...register("primaryEmail")} />
        </Field>
        <Field label="UAE mobile number" htmlFor="primaryMobile" error={errors.primaryMobile?.message}>
          <Input
            id="primaryMobile"
            type="tel"
            placeholder="050 123 4567"
            data-testid="input-primary-mobile"
            {...register("primaryMobile")}
          />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nationality" htmlFor="nationality" error={errors.nationality?.message}>
          <Input id="nationality" data-testid="input-nationality" {...register("nationality")} />
        </Field>
        <Field label="Emirate of residence" htmlFor="emirate" error={errors.emirate?.message}>
          <Select value={watch("emirate")} onValueChange={(v) => setValue("emirate", v, { shouldValidate: true })}>
            <SelectTrigger id="emirate" data-testid="select-emirate">
              <SelectValue placeholder="Select emirate" />
            </SelectTrigger>
            <SelectContent>
              {EMIRATES.map((e) => (
                <SelectItem key={e} value={e}>
                  {e}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="New member or renewal?" htmlFor="memberStatus">
          <RadioGroup
            value={watch("memberStatus")}
            onValueChange={(v) => setValue("memberStatus", v as "new" | "renewal")}
            className="flex gap-4 pt-1.5"
          >
            <label className="flex items-center gap-2 text-sm">
              <RadioGroupItem value="new" id="status-new" data-testid="radio-status-new" />
              New Member
            </label>
            <label className="flex items-center gap-2 text-sm">
              <RadioGroupItem value="renewal" id="status-renewal" data-testid="radio-status-renewal" />
              Renewal
            </label>
          </RadioGroup>
        </Field>

        <Field label="Previous ADIS member?" htmlFor="previousMember">
          <RadioGroup
            value={watch("previousMember") ? "yes" : "no"}
            onValueChange={(v) => setValue("previousMember", v === "yes")}
            className="flex gap-4 pt-1.5"
          >
            <label className="flex items-center gap-2 text-sm">
              <RadioGroupItem value="yes" id="previous-yes" data-testid="radio-previous-yes" />
              Yes
            </label>
            <label className="flex items-center gap-2 text-sm">
              <RadioGroupItem value="no" id="previous-no" data-testid="radio-previous-no" />
              No
            </label>
          </RadioGroup>
        </Field>
      </div>
    </div>
  );
}

function FamilyStep({
  form,
  childFields,
  appendChild,
  removeChild,
}: {
  form: ReturnType<typeof useForm<JoinFormValues>>;
  childFields: { id: string }[];
  appendChild: (v: { firstName: string; surname: string; dob: string }) => void;
  removeChild: (i: number) => void;
}) {
  const { register, formState } = form;
  const errors = formState.errors;
  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <StepHeading title="Second Adult / Partner" description="Details for the second adult on this membership." />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="First name"
            htmlFor="secondAdultFirstName"
            error={errors.secondAdultFirstName?.message}
          >
            <Input
              id="secondAdultFirstName"
              data-testid="input-second-adult-first-name"
              {...register("secondAdultFirstName")}
            />
          </Field>
          <Field label="Surname" htmlFor="secondAdultSurname" error={errors.secondAdultSurname?.message}>
            <Input
              id="secondAdultSurname"
              data-testid="input-second-adult-surname"
              {...register("secondAdultSurname")}
            />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Email address" htmlFor="secondAdultEmail">
            <Input
              id="secondAdultEmail"
              type="email"
              data-testid="input-second-adult-email"
              {...register("secondAdultEmail")}
            />
          </Field>
          <Field label="Mobile number" htmlFor="secondAdultMobile">
            <Input
              id="secondAdultMobile"
              type="tel"
              data-testid="input-second-adult-mobile"
              {...register("secondAdultMobile")}
            />
          </Field>
        </div>
      </div>

      <div className="space-y-3 border-t border-border pt-5">
        <StepHeading title="Children / Dependants" description="Add each child included on this family membership." />

        {childFields.length === 0 && (
          <p className="text-sm text-muted-foreground" data-testid="text-no-children">
            No children added yet.
          </p>
        )}

        <div className="space-y-3">
          {childFields.map((field, index) => (
            <div
              key={field.id}
              className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-[1fr_1fr_1fr_auto]"
              data-testid={`row-child-${index}`}
            >
              <Field label="First name" htmlFor={`children.${index}.firstName`}>
                <Input
                  id={`children.${index}.firstName`}
                  data-testid={`input-child-first-name-${index}`}
                  {...register(`children.${index}.firstName` as const)}
                />
              </Field>
              <Field label="Surname" htmlFor={`children.${index}.surname`}>
                <Input
                  id={`children.${index}.surname`}
                  data-testid={`input-child-surname-${index}`}
                  {...register(`children.${index}.surname` as const)}
                />
              </Field>
              <Field label="Date of birth" htmlFor={`children.${index}.dob`}>
                <Input
                  id={`children.${index}.dob`}
                  type="date"
                  data-testid={`input-child-dob-${index}`}
                  {...register(`children.${index}.dob` as const)}
                />
              </Field>
              <div className="flex items-end">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => removeChild(index)}
                  aria-label="Remove child"
                  data-testid={`button-remove-child-${index}`}
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            </div>
          ))}
        </div>

        <Button
          type="button"
          variant="outline"
          onClick={() => appendChild({ firstName: "", surname: "", dob: "" })}
          data-testid="button-add-child"
        >
          <Plus className="h-4 w-4 mr-1.5" />
          Add Child
        </Button>
      </div>
    </div>
  );
}

function PreferencesStep({ form }: { form: ReturnType<typeof useForm<JoinFormValues>> }) {
  const { watch, setValue, formState } = form;
  const errors = formState.errors;
  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <StepHeading title="Membership Communication" description="How would you like to hear from the Abu Dhabi Irish Society?" />
        <RadioGroup
          value={watch("communicationPreference")}
          onValueChange={(v) => setValue("communicationPreference", v as any, { shouldValidate: true })}
          className="flex flex-wrap gap-4"
        >
          {[
            { value: "email", label: "Email" },
            { value: "whatsapp", label: "WhatsApp" },
            { value: "both", label: "Both" },
          ].map((opt) => (
            <label key={opt.value} className="flex items-center gap-2 text-sm">
              <RadioGroupItem value={opt.value} id={`comm-${opt.value}`} data-testid={`radio-comm-${opt.value}`} />
              {opt.label}
            </label>
          ))}
        </RadioGroup>
        {errors.communicationPreference && (
          <p className="text-sm text-destructive">{errors.communicationPreference.message}</p>
        )}
      </div>

      <div className="space-y-3 border-t border-border pt-5">
        <ToggleRow
          label="Would you like to join the ADIS WhatsApp Community?"
          checked={watch("joinWhatsappCommunity")}
          onChange={(v) => setValue("joinWhatsappCommunity", v)}
          testId="joinWhatsappCommunity"
        />
        <ToggleRow
          label="Would you like to receive information about ADIS events, member offers, partner discounts and community activities?"
          checked={watch("receiveMarketing")}
          onChange={(v) => setValue("receiveMarketing", v)}
          testId="receiveMarketing"
        />
      </div>

      <div className="space-y-3 border-t border-border pt-5">
        <StepHeading title="Terms & Consent" />
        <label className="flex items-start gap-3 text-sm">
          <Checkbox
            checked={watch("consentTerms")}
            onCheckedChange={(v) => setValue("consentTerms", Boolean(v), { shouldValidate: true })}
            data-testid="checkbox-consent-terms"
          />
          <span>
            I confirm that the information provided is correct and I agree to the Abu Dhabi Irish Society's
            membership terms and conditions.
          </span>
        </label>
        {errors.consentTerms && <p className="text-sm text-destructive">{errors.consentTerms.message}</p>}

        <label className="flex items-start gap-3 text-sm">
          <Checkbox
            checked={watch("consentPrivacy")}
            onCheckedChange={(v) => setValue("consentPrivacy", Boolean(v), { shouldValidate: true })}
            data-testid="checkbox-consent-privacy"
          />
          <span>
            I consent to the Abu Dhabi Irish Society storing and using my information for the administration of my
            membership in accordance with its privacy policy.
          </span>
        </label>
        {errors.consentPrivacy && <p className="text-sm text-destructive">{errors.consentPrivacy.message}</p>}

        <p className="text-xs text-muted-foreground">
          Marketing consent above is separate and optional — it will never affect your membership.
        </p>
      </div>
    </div>
  );
}

function ToggleRow({
  label,
  checked,
  onChange,
  testId,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  testId: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-3">
      <span className="text-sm text-foreground">{label}</span>
      <RadioGroup value={checked ? "yes" : "no"} onValueChange={(v) => onChange(v === "yes")} className="flex gap-3">
        <label className="flex items-center gap-1.5 text-sm">
          <RadioGroupItem value="yes" data-testid={`radio-${testId}-yes`} />
          Yes
        </label>
        <label className="flex items-center gap-1.5 text-sm">
          <RadioGroupItem value="no" data-testid={`radio-${testId}-no`} />
          No
        </label>
      </RadioGroup>
    </div>
  );
}

function ReviewStep({
  form,
  isFamily,
  amountDue,
}: {
  form: ReturnType<typeof useForm<JoinFormValues>>;
  isFamily: boolean;
  amountDue: number;
}) {
  const values = form.watch();
  return (
    <div className="space-y-6">
      <StepHeading title="Review & Pay" description="Please confirm your details before completing payment." />

      <div className="rounded-lg border border-border p-4 text-sm">
        <dl className="grid gap-2 sm:grid-cols-2">
          <Row label="Membership selected" value={isFamily ? "Family" : "Single"} />
          <Row label="Primary member" value={values.primaryFullName || "—"} />
          <Row label="Email" value={values.primaryEmail || "—"} />
          <Row label="Mobile" value={values.primaryMobile || "—"} />
          {isFamily && (
            <Row
              label="Second adult"
              value={
                values.secondAdultFirstName
                  ? `${values.secondAdultFirstName} ${values.secondAdultSurname ?? ""}`.trim()
                  : "—"
              }
            />
          )}
          {isFamily && <Row label="Children" value={String(values.children?.length ?? 0)} />}
        </dl>
      </div>

      <div className="rounded-lg border border-primary/30 bg-accent p-4">
        <div className="flex items-center justify-between text-sm">
          <span className="text-foreground">Membership fee</span>
          <span className="font-medium text-foreground">AED {amountDue}</span>
        </div>
        <div className="mt-2 flex items-center justify-between border-t border-primary/20 pt-2">
          <span className="font-medium text-foreground">Total due</span>
          <span className="text-lg font-semibold font-serif text-primary" data-testid="text-total-due">
            AED {amountDue}
          </span>
        </div>
      </div>

      <div>
        <p className="mb-2 text-xs text-muted-foreground">Accepted payment methods</p>
        <div className="flex flex-wrap gap-2">
          {["Visa", "Mastercard", "Apple Pay", "Google Pay"].map((m) => (
            <span
              key={m}
              className="rounded-md border border-border bg-card px-2.5 py-1 text-xs text-muted-foreground"
            >
              {m}
            </span>
          ))}
        </div>
        <p className="mt-3 flex items-start gap-1.5 text-xs text-muted-foreground">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
          Card processing is being connected — ADIS never stores your card details. Your registration is reserved
          now and the committee will confirm once secure online payment is live.
        </p>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-foreground">{value}</dd>
    </div>
  );
}

function SuccessScreen({ info }: { info: SuccessInfo }) {
  const expiry = new Date(info.membershipExpiryDate);
  return (
    <div className="min-h-dvh bg-background flex items-center justify-center px-4 py-12">
      <Card className="max-w-md w-full" data-testid="card-success">
        <CardContent className="p-8 text-center">
          <AdisLogo className="mx-auto h-12 w-auto mb-6" />
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-accent">
            <CheckCircle2 className="h-8 w-8 text-primary" />
          </div>
          <h1 className="text-xl font-semibold font-serif text-foreground">Welcome to the Abu Dhabi Irish Society!</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Thank you for becoming a member of the Abu Dhabi Irish Society. Your membership registration has been
            successfully received.
          </p>
          <div className="mt-6 space-y-2 rounded-lg border border-border p-4 text-left text-sm">
            <Row label="Membership number" value={info.membershipNumber} />
            <Row label="Member" value={info.primaryFullName} />
            <Row label="Membership type" value={info.membershipType === "family" ? "Family" : "Single"} />
            <Row label="Amount due" value={`AED ${info.amountDue}`} />
            <Row label="Membership expires" value={expiry.toLocaleDateString("en-GB")} />
          </div>
          <p className="mt-6 text-sm text-muted-foreground">
            {info.cardEmailSent
              ? "Check your email for your personal digital membership card, complete with a rotating QR code for entry to ADIS events."
              : "We couldn't send your digital membership card email just now \u2014 please contact the ADIS committee and we'll issue it manually."}
          </p>
          <p className="mt-3 text-sm text-muted-foreground">
            You'll also receive information about upcoming events, member benefits and the ADIS community.
          </p>
          <p className="mt-4 font-serif text-lg text-primary">Céad Míle Fáilte! 🇮🇪</p>
        </CardContent>
      </Card>
    </div>
  );
}
