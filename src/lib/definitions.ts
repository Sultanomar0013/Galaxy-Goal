import * as z from "zod";

export const LoginSchema = z.object({
  email: z.email({ error: "Enter a valid email." }).trim().toLowerCase(),
  password: z.string().min(1, { error: "Enter your password." }),
});

export const SignupSchema = z.object({
  name: z.string().trim().min(2, { error: "Name must be at least 2 characters." }).max(100),
  email: z.email({ error: "Enter a valid email." }).trim().toLowerCase().max(191),
  password: z
    .string()
    .min(8, { error: "At least 8 characters." })
    .max(72, { error: "At most 72 characters." }) // bcrypt ignores anything past 72 bytes
    .regex(/[a-zA-Z]/, { error: "At least one letter." })
    .regex(/[0-9]/, { error: "At least one number." }),
});

export const VerifySchema = z.object({
  email: z.email().trim().toLowerCase(),
  code: z.string().trim().regex(/^\d{6}$/),
});

export type VerifyFormState = { error?: string; info?: string } | undefined;

export type AuthFormState =
  | {
      errors?: Partial<Record<"name" | "email" | "password", string[]>>;
      message?: string;
      email?: string;
      name?: string;
    }
  | undefined;
