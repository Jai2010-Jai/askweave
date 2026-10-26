"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useLang } from "@/i18n/LangProvider";
import { authErrorKey, supabase, useSession } from "@/lib/supabase";
import { AuthShell } from "./AuthShell";
import { Field } from "./Field";

type ErrKey = keyof ReturnType<typeof useLang>["t"]["waitlist"]["errors"];

/** Landing page for the password reset email: the link logs the person in, then they pick a new password. */
export function ResetForm() {
  const { t } = useLang();
  const a = t.auth;
  const w = t.waitlist;
  const router = useRouter();
  const session = useSession();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ErrKey | null>(null);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const password = String(new FormData(e.currentTarget).get("password") ?? "");
    if (password.length < 8) return setErr("weak");
    if (!supabase) return;
    setBusy(true);
    setErr(null);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) return setErr(authErrorKey(error) as ErrKey);
    router.replace("/account");
  };

  return (
    <AuthShell title={a.newTitle}>
      {session === undefined ? (
        <p className="auth-lede">{t.account.loading}</p>
      ) : session === null ? (
        <div className="form">
          <p className="form-error">{a.newExpired}</p>
          <p className="form-foot">
            <Link href="/login">← {a.back}</Link>
          </p>
        </div>
      ) : (
        <form className="form" onSubmit={submit}>
          <Field
            label={w.password}
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
            autoFocus
            hint={w.passwordHint}
          />
          {err && (
            <p className="form-error" role="alert">
              {w.errors[err]}
            </p>
          )}
          <button className="btn" type="submit" disabled={busy}>
            {a.newSubmit}
          </button>
        </form>
      )}
    </AuthShell>
  );
}
