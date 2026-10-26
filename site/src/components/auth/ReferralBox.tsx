"use client";

import { useEffect, useState } from "react";
import { useLang } from "@/i18n/LangProvider";
import { fill, supabase, useSession } from "@/lib/supabase";

const REF_KEY = "weave-ref";

/** Remembers the invite code from a ?ref= link so it can be sent with the sign-up. */
export function rememberRef() {
  const ref = new URLSearchParams(location.search).get("ref");
  if (!ref) return;
  try {
    localStorage.setItem(REF_KEY, ref.slice(0, 16));
  } catch {}
}

export function savedRef() {
  try {
    return localStorage.getItem(REF_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

/** The logged-in person's invite link and how many people joined with it. */
export function ReferralBox() {
  const { t } = useLang();
  const r = t.referral;
  const session = useSession();
  const [code, setCode] = useState<string | null>(null);
  const [count, setCount] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!session || !supabase) return;
    // Shows nothing until the referrals SQL has been run and the person has a code.
    supabase
      .from("waitlist")
      .select("ref_code")
      .eq("id", session.user.id)
      .single()
      .then(({ data }) => setCode((data as { ref_code?: string } | null)?.ref_code ?? null));
    supabase.rpc("my_referrals").then(({ data }) => setCount((data as number) ?? 0));
  }, [session]);

  if (!code) return null;
  const link = `${location.origin}/?ref=${code}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  return (
    <div className="ref-box">
      <h3>{r.title}</h3>
      <p>{r.body}</p>
      <div className="ref-link">
        <input value={link} readOnly onFocus={(e) => e.currentTarget.select()} aria-label={r.title} />
        <button className="btn" type="button" onClick={copy}>
          {copied ? r.copied : r.copy}
        </button>
      </div>
      {count !== null && <p className="ref-count">{count > 0 ? fill(r.count, { n: count }) : r.none}</p>}
    </div>
  );
}
