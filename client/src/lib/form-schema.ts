import { z } from "zod";

export const childFormSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  surname: z.string().min(1, "Surname is required"),
  dob: z.string().min(1, "Date of birth is required"),
});

export const joinFormSchema = z
  .object({
    membershipType: z.enum(["single", "family"], {
      message: "Please select a membership type",
    }),

    primaryFullName: z.string().min(2, "Enter the primary member's full name"),
    primaryEmail: z.string().email("Enter a valid email address"),
    primaryMobile: z.string().min(7, "Enter a valid UAE mobile number"),
    nationality: z.string().min(2, "Enter a nationality"),
    emirate: z.string().min(1, "Select an emirate"),
    memberStatus: z.enum(["new", "renewal"]),
    previousMember: z.boolean(),

    secondAdultFirstName: z.string().optional().or(z.literal("")),
    secondAdultSurname: z.string().optional().or(z.literal("")),
    secondAdultEmail: z.string().optional().or(z.literal("")),
    secondAdultMobile: z.string().optional().or(z.literal("")),

    children: z.array(childFormSchema),

    communicationPreference: z.enum(["email", "whatsapp", "both"], {
      message: "Choose how you'd like to hear from ADIS",
    }),
    joinWhatsappCommunity: z.boolean(),
    receiveMarketing: z.boolean(),

    consentTerms: z.boolean(),
    consentPrivacy: z.boolean(),
  })
  .superRefine((data, ctx) => {
    if (data.membershipType === "family") {
      if (!data.secondAdultFirstName) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Second adult's first name is required for a family membership",
          path: ["secondAdultFirstName"],
        });
      }
      if (!data.secondAdultSurname) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Second adult's surname is required for a family membership",
          path: ["secondAdultSurname"],
        });
      }
    }
    if (!data.consentTerms) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "You must confirm the membership terms and conditions",
        path: ["consentTerms"],
      });
    }
    if (!data.consentPrivacy) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "You must consent to the privacy policy",
        path: ["consentPrivacy"],
      });
    }
  });

export type JoinFormValues = z.infer<typeof joinFormSchema>;

export const EMIRATES = [
  "Abu Dhabi",
  "Dubai",
  "Sharjah",
  "Ajman",
  "Umm Al Quwain",
  "Ras Al Khaimah",
  "Fujairah",
];

export const MEMBERSHIP_FEES: Record<"single" | "family", number> = {
  single: 100,
  family: 200,
};
