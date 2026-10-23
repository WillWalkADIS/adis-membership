import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { EMIRATES } from "@/lib/form-schema";

export interface EditableMember {
  id: number;
  membershipNumber: string;
  membershipType: "single" | "family";
  paymentStatus: string;
  primaryFullName: string;
  primaryEmail: string;
  primaryMobile: string;
  nationality: string;
  emirate: string;
  communicationPreference: "email" | "whatsapp" | "both";
  secondAdultFirstName: string | null;
  secondAdultSurname: string | null;
  secondAdultEmail: string | null;
  secondAdultMobile: string | null;
  children: { firstName: string; surname: string; dob: string }[];
}

type FormState = Omit<EditableMember, "id" | "membershipNumber" | "membershipType" | "paymentStatus"> & {
  secondAdultFirstName: string;
  secondAdultSurname: string;
  secondAdultEmail: string;
  secondAdultMobile: string;
};

function toForm(m: EditableMember): FormState {
  return {
    primaryFullName: m.primaryFullName ?? "",
    primaryEmail: m.primaryEmail ?? "",
    primaryMobile: m.primaryMobile ?? "",
    nationality: m.nationality ?? "",
    emirate: m.emirate ?? "",
    communicationPreference: m.communicationPreference ?? "email",
    secondAdultFirstName: m.secondAdultFirstName ?? "",
    secondAdultSurname: m.secondAdultSurname ?? "",
    secondAdultEmail: m.secondAdultEmail ?? "",
    secondAdultMobile: m.secondAdultMobile ?? "",
    children: (m.children ?? []).map((c) => ({ ...c, dob: (c.dob ?? "").slice(0, 10) })),
  };
}

function validate(f: FormState, isFamily: boolean): string | null {
  const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (f.primaryFullName.trim().length < 2) return "Enter the member's full name.";
  if (!email.test(f.primaryEmail.trim())) return "Enter a valid email address for the member.";
  if (f.primaryMobile.trim().length < 7) return "Enter a valid mobile number for the member.";
  if (f.nationality.trim().length < 2) return "Enter a nationality.";
  if (!f.emirate) return "Select an emirate.";
  if (isFamily) {
    if (!f.secondAdultFirstName.trim() || !f.secondAdultSurname.trim())
      return "A family membership needs the second adult's first name and surname.";
    if (!email.test(f.secondAdultEmail.trim())) return "Enter a valid email address for the second adult.";
  }
  for (const c of f.children) {
    if (!c.firstName.trim() || !c.surname.trim() || !c.dob.trim())
      return "Each child needs a first name, surname and date of birth (or remove the row).";
  }
  return null;
}

export function EditMemberDialog({
  member,
  onClose,
}: {
  member: EditableMember | null;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [form, setForm] = useState<FormState | null>(null);
  const [resendCard, setResendCard] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setForm(member ? toForm(member) : null);
    setResendCard(false);
    setError(null);
  }, [member]);

  const save = useMutation({
    mutationFn: async (body: FormState & { resendCard: boolean }) => {
      const res = await apiRequest("PATCH", `/api/registrations/${member!.id}/details`, body);
      return res.json() as Promise<{ cardResent: boolean }>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/registrations"] });
      toast({
        title: "Member details updated",
        description: data.cardResent ? "The membership card was re-sent to the updated email." : undefined,
      });
      onClose();
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message.replace(/^\d+:\s*/, "") : "";
      let readable = "Could not save the changes. Please try again.";
      try {
        readable = JSON.parse(msg).message || readable;
      } catch {
        /* keep default */
      }
      setError(readable);
    },
  });

  if (!member || !form) return null;
  const isFamily = member.membershipType === "family";
  const isPaid = member.paymentStatus === "paid";
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm({ ...form, [key]: value });
  const setChild = (i: number, key: "firstName" | "surname" | "dob", value: string) =>
    set(
      "children",
      form.children.map((c, j) => (j === i ? { ...c, [key]: value } : c)),
    );

  const field = (id: keyof FormState, label: string, type = "text") => (
    <div className="space-y-1.5">
      <Label htmlFor={`edit-${id}`}>{label}</Label>
      <Input
        id={`edit-${id}`}
        type={type}
        value={form[id] as string}
        onChange={(e) => set(id, e.target.value as never)}
        data-testid={`input-edit-${id}`}
      />
    </div>
  );

  return (
    <Dialog open={!!member} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit member details</DialogTitle>
          <DialogDescription>
            {member.membershipNumber} · {isFamily ? "Family" : "Single"} membership. Changes show on the member's card
            and at the door straight away.
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-6"
          onSubmit={(e) => {
            e.preventDefault();
            const problem = validate(form, isFamily);
            setError(problem);
            if (!problem) save.mutate({ ...form, resendCard: isPaid && resendCard });
          }}
        >
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-foreground">Primary member</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              {field("primaryFullName", "Full name")}
              {field("primaryEmail", "Email", "email")}
              {field("primaryMobile", "Mobile", "tel")}
              {field("nationality", "Nationality")}
              <div className="space-y-1.5">
                <Label htmlFor="edit-emirate">Emirate of residence</Label>
                <Select value={form.emirate} onValueChange={(v) => set("emirate", v)}>
                  <SelectTrigger id="edit-emirate" data-testid="select-edit-emirate">
                    <SelectValue placeholder="Select emirate" />
                  </SelectTrigger>
                  <SelectContent>
                    {(EMIRATES.includes(form.emirate) || !form.emirate ? EMIRATES : [...EMIRATES, form.emirate]).map((e) => (
                      <SelectItem key={e} value={e}>
                        {e}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-comms">Contact preference</Label>
                <Select
                  value={form.communicationPreference}
                  onValueChange={(v) => set("communicationPreference", v as FormState["communicationPreference"])}
                >
                  <SelectTrigger id="edit-comms" data-testid="select-edit-comms">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="email">Email</SelectItem>
                    <SelectItem value="whatsapp">WhatsApp</SelectItem>
                    <SelectItem value="both">Email and WhatsApp</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </section>

          {isFamily && (
            <section className="space-y-3">
              <h3 className="text-sm font-semibold text-foreground">Second adult</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                {field("secondAdultFirstName", "First name")}
                {field("secondAdultSurname", "Surname")}
                {field("secondAdultEmail", "Email", "email")}
                {field("secondAdultMobile", "Mobile (optional)", "tel")}
              </div>
            </section>
          )}

          {(isFamily || form.children.length > 0) && (
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-foreground">Children</h3>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => set("children", [...form.children, { firstName: "", surname: "", dob: "" }])}
                  data-testid="button-edit-add-child"
                >
                  <Plus className="mr-1 h-4 w-4" />
                  Add child
                </Button>
              </div>
              {form.children.length === 0 && <p className="text-sm text-muted-foreground">No children listed.</p>}
              {form.children.map((c, i) => (
                <div key={i} className="grid items-end gap-2 sm:grid-cols-[1fr_1fr_10rem_auto]">
                  <div className="space-y-1.5">
                    <Label htmlFor={`edit-child-${i}-first`}>First name</Label>
                    <Input id={`edit-child-${i}-first`} value={c.firstName} onChange={(e) => setChild(i, "firstName", e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`edit-child-${i}-surname`}>Surname</Label>
                    <Input id={`edit-child-${i}-surname`} value={c.surname} onChange={(e) => setChild(i, "surname", e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`edit-child-${i}-dob`}>Date of birth</Label>
                    <Input id={`edit-child-${i}-dob`} type="date" value={c.dob} onChange={(e) => setChild(i, "dob", e.target.value)} />
                  </div>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="text-destructive"
                    aria-label={`Remove child ${i + 1}`}
                    onClick={() => set("children", form.children.filter((_, j) => j !== i))}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </section>
          )}

          {isPaid && (
            <label className="flex items-start gap-2 rounded-md border border-border p-3 text-sm">
              <Checkbox
                checked={resendCard}
                onCheckedChange={(v) => setResendCard(v === true)}
                data-testid="checkbox-edit-resend-card"
                className="mt-0.5"
              />
              <span>
                Re-send the membership card after saving
                <span className="block text-xs text-muted-foreground">
                  Tick this if you corrected an email address, so the card reaches the right inbox.
                </span>
              </span>
            </label>
          )}

          {error && (
            <p className="text-sm text-destructive" data-testid="text-edit-error">
              {error}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending} data-testid="button-edit-save">
              {save.isPending ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
