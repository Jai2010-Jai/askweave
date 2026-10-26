"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { useLang } from "@/i18n/LangProvider";
import { authErrorKey, supabase, useSession } from "@/lib/supabase";
import { AuthShell } from "./AuthShell";
import { Field } from "./Field";

type ErrKey = keyof ReturnType<typeof useLang>["t"]["waitlist"]["errors"];

/** Log in, with a "forgot password" mode that emails a reset link. */
export function LoginForm() {
  const { t } = useLang();
  const a = t.auth;
  const w = t.waitlist;
  const router = useRouter();
  const session = useSession();
  const [mode, setMode] = useState<"login" | "reset">("login");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ErrKey | "offline" | null>(null);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    if (session) router.replace("/account");
  }, [session, router]);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const email = String(f.get("email") ?? "").trim();
    if (!supabase) return setErr("offline");
    setBusy(true);
    setErr(null);
    if (mode === "reset") {
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}/reset` });
      setBusy(false);
      // Say the same thing whether or not the address exists, so the form can't be used to look people up.
      if (error && authErrorKey(error) === "rate") return setErr("rate");
      return setSent(true);
    }
    const { error } = await supabase.auth.signInWithPassword({ email, password: String(f.get("password") ?? "") });
    setBusy(false);
    if (error) return setErr(authErrorKey(error) as ErrKey);
    router.replace("/account");
  };

  const switchMode = (m: "login" | "reset") => {
    setMode(m);
    setErr(null);
    setSent(false);
  };

  return (
    <AuthShell
      title={mode === "login" ? a.loginTitle : a.resetTitle}
      lede={mode === "login" ? a.loginLede : a.resetLede}
    >
      <form className="form" onSubmit={submit} key={mode}>
        <Field label={w.email} name="email" type="email" autoComplete="email" placeholder={w.emailPh} required autoFocus />
        {mode === "login" && (
          <Field label={w.password} name="password" type="password" autoComplete="current-password" required />
        )}
        {err && (
          <p className="form-error" role="alert">
            {err === "offline" ? w.offline : w.errors[err]}
          </p>
        )}
        {sent && <p className="form-note">{a.resetSent}</p>}
        <button className="btn" type="submit" disabled={busy}>
          {mode === "login" ? (busy ? a.sending : a.submit) : a.resetSend}
        </button>
        {mode === "login" ? (
          <>
            <p className="form-foot">
              <button type="button" className="text-link" onClick={() => switchMode("reset")}>
                {a.forgot}
              </button>
            </p>
            <p className="form-foot">
              {a.noAccount} <Link href="/#waitlist">{a.join}</Link>
            </p>
          </>
        ) : (
          <p className="form-foot">
            <button type="button" className="text-link" onClick={() => switchMode("login")}>
              ← {a.back}
            </button>
          </p>
        )}
      </form>
    </AuthShell>
  );
}
