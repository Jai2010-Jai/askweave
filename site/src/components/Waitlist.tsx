"use client";

import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState, type FormEvent } from "react";
import { useLang } from "@/i18n/LangProvider";
import { authErrorKey, fill, supabase, useSession } from "@/lib/supabase";
import { Field } from "./auth/Field";
import { ReferralBox, rememberRef, savedRef } from "./auth/ReferralBox";
import { Reveal } from "./ui";
import "./auth/auth.css";

type ErrKey = keyof ReturnType<typeof useLang>["t"]["waitlist"]["errors"];
type Done = { kind: "joined"; position: number | null } | { kind: "check"; email: string };

export function Waitlist() {
  const { t, lang } = useLang();
  const w = t.waitlist;
  const session = useSession();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ErrKey | "offline" | null>(null);
  const [done, setDone] = useState<Done | null>(null);

  useEffect(rememberRef, []);

  // Someone already logged in sees their place in line instead of the form.
  useEffect(() => {
    if (!session || !supabase) return;
    supabase.rpc("waitlist_position").then(({ data }) => setDone({ kind: "joined", position: (data as number) ?? null }));
  }, [session]);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const name = String(f.get("name") ?? "").trim();
    const email = String(f.get("email") ?? "").trim();
    const password = String(f.get("password") ?? "");
    const building = String(f.get("building") ?? "").trim();
    if (!name) return setErr("name");
    if (password.length < 8) return setErr("weak");
    if (!supabase) return setErr("offline");

    setBusy(true);
    setErr(null);
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { name, building, lang, ref: savedRef() }, emailRedirectTo: `${location.origin}/account` },
    });
    setBusy(false);
    if (error) return setErr(authErrorKey(error) as ErrKey);
    // With email confirmation on, an existing address comes back as a user with no identities.
    if (data.user && data.user.identities?.length === 0) return setErr("exists");
    if (!data.session) setDone({ kind: "check", email });
    // With confirmation off the person is logged in straight away, and the effect above loads their position.
  };

  return (
    <section id="waitlist" className="waitlist">
      <div className="wrap wl-wrap">
        <Reveal className="wl-head">
          <h2>
            {w.titlePre} {w.titleHand}
          </h2>
          <p className="wl-lede">{w.lede}</p>
        </Reveal>
        <Reveal className="wl-card" delay={0.1}>
          <AnimatePresence mode="wait">
            {done ? (
              <motion.div
                key="done"
                className="wl-done"
                initial={{ opacity: 0, scale: 0.94 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ type: "spring", stiffness: 260, damping: 22 }}
              >
                <motion.span
                  className="wl-stamp"
                  initial={{ scale: 2, opacity: 0, rotate: -30 }}
                  animate={{ scale: 1, opacity: 1, rotate: -8 }}
                  transition={{ type: "spring", stiffness: 420, damping: 16, delay: 0.15 }}
                >
                  {done.kind === "joined" ? "✓" : "✉"}
                </motion.span>
                {done.kind === "joined" ? (
                  <>
                    <h3>{w.joinedTitle}</h3>
                    {done.position && <p className="wl-num">#{done.position}</p>}
                    {done.position && <p>{fill(w.position, { n: done.position })}</p>}
                    <ReferralBox />
                    <Link className="btn ghost" href="/account">
                      {w.viewAccount}
                    </Link>
                  </>
                ) : (
                  <>
                    <h3>{w.checkTitle}</h3>
                    <p>{fill(w.checkBody, { email: done.email })}</p>
                  </>
                )}
              </motion.div>
            ) : (
              <motion.form key="form" className="form" onSubmit={submit} exit={{ opacity: 0, y: -10 }}>
                <Field label={w.name} name="name" autoComplete="name" placeholder={w.namePh} required maxLength={100} />
                <Field label={w.email} name="email" type="email" autoComplete="email" placeholder={w.emailPh} required />
                <Field
                  label={w.password}
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  required
                  hint={w.passwordHint}
                />
                <Field
                  label={w.building}
                  aside={w.optional}
                  name="building"
                  multiline
                  maxLength={500}
                  placeholder={w.buildingPh}
                />
                {err && (
                  <p className="form-error" role="alert">
                    {err === "offline" ? w.offline : w.errors[err]}
                    {err === "exists" && (
                      <>
                        {" "}
                        <Link href="/login">{w.login} →</Link>
                      </>
                    )}
                  </p>
                )}
                <button className="btn" type="submit" disabled={busy}>
                  {busy ? w.sending : w.submit}
                </button>
                <p className="form-agree">
                  {w.agree} <Link href="/terms">{t.legal.terms}</Link> · <Link href="/privacy">{t.legal.privacy}</Link>
                </p>
              </motion.form>
            )}
          </AnimatePresence>
        </Reveal>
        {!done && (
          <p className="wl-have">
            {w.haveAccount} <Link href="/login">{w.login} →</Link>
          </p>
        )}
      </div>
    </section>
  );
}
