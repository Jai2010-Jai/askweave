"use client";

import { createClient, type Session } from "@supabase/supabase-js";
import { useEffect, useState } from "react";

// Both values are public by design: the anon key only allows what the database's
// row level security rules allow (see supabase/schema.sql).
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/** null until the Supabase project's URL and key are set in .env.local / Netlify. */
export const supabase = url && key ? createClient(url, key) : null;

export type WaitlistRow = {
  id: string;
  email: string;
  name: string;
  building: string | null;
  lang: string | null;
  created_at: string;
  ref_code?: string;
};

/** undefined while loading, null when logged out. */
export function useSession() {
  const [session, setSession] = useState<Session | null | undefined>(supabase ? undefined : null);
  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);
  return session;
}

/** Turns a Supabase auth error into one of the site's translated messages. */
export function authErrorKey(err: { message?: string; code?: string; status?: number }) {
  const m = `${err.code ?? ""} ${err.message ?? ""}`.toLowerCase();
  if (m.includes("invalid_credentials") || m.includes("invalid login")) return "invalid";
  if (m.includes("email_not_confirmed") || m.includes("not confirmed")) return "unconfirmed";
  if (m.includes("already") || m.includes("user_already_exists")) return "exists";
  if (m.includes("weak") || m.includes("password should")) return "weak";
  if (err.status === 429 || m.includes("rate")) return "rate";
  return "generic";
}

/** Replaces {name}-style placeholders in translated strings. */
export function fill(s: string, vars: Record<string, string | number>) {
  return s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ""));
}
