import type { Metadata } from "next";
import Link from "next/link";
import { WeaveLogo } from "@/components/WeaveLogo";
import "./not-found.css";

export const metadata: Metadata = { title: "Page not found · Weave" };

export default function NotFound() {
  return (
    <main className="nf">
      <div className="nf-logo">
        <WeaveLogo play="mount" duration={1.6} />
      </div>
      <h1>This page came unravelled.</h1>
      <p>The link may be old, or the page has moved.</p>
      <Link className="btn" href="/">
        Back to Weave
      </Link>
    </main>
  );
}
