import type { Metadata } from "next";
import { AccountView } from "@/components/auth/AccountView";

export const metadata: Metadata = {
  title: "Your account · Weave",
  robots: { index: false },
};

export default function AccountPage() {
  return <AccountView />;
}
