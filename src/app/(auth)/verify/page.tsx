import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { VerifyForm } from "./verify-form";

export const metadata: Metadata = { title: "Verify email · Goal Galaxy" };

export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string; sent?: string }>;
}) {
  const { email, sent } = await searchParams;
  if (!email) redirect("/signup");

  return <VerifyForm email={email} sendFailed={sent === "0"} />;
}
