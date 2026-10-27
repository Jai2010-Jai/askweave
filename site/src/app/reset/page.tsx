import type { Metadata } from "next";
import { ResetForm } from "@/components/auth/ResetForm";

export const metadata: Metadata = {
  title: "Choose a new password · Weave",
  robots: { index: false },
};

export default function ResetPage() {
  return <ResetForm />;
}
