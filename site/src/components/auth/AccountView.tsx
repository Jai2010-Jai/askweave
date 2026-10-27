"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { useLang } from "@/i18n/LangProvider";
import { fill, supabase, useSession, type WaitlistRow } from "@/lib/supabase";
import { AuthShell } from "./AuthShell";
import { Field } from "./Field";
import { ReferralBox } from "./ReferralBox";

/** Place in line, editable details, log out and delete account. */
export function AccountView() {
  const { t, lang } = useLang();
  const c = t.account;
  const w = t.waitlist;
  const router = useRouter();
  const session = useSession();
  const [row, setRow] = useState<WaitlistRow | null>(null);
  const [position, setPosition] = useState<number | null>(null);
  const [saving, setSaving] = useState<"idle" | "busy" | "saved">("idle");
  const [confirm, setConfirm] = useState("");
  const [deleted, setDeleted] = useState(false);
  const [err, setErr] = useState(false);

  useEffect(() => {
    if (session === null && !deleted) router.replace("/login");
    if (!session || !supabase) return;
    supabase
      .from("waitlist")
      .select("*")
      .eq("id", session.user.id)
      .single()
      .then(({ data }) => (data ? setRow(data as WaitlistRow) : setErr(true)));
    supabase.rpc("waitlist_position").then(({ data }) => setPosition((data as number) ?? null));
  }, [session, deleted, router]);

  const save = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!supabase || !row) return;
    const f = new FormData(e.currentTarget);
    const name = String(f.get("name") ?? "").trim().slice(0, 100);
    const building = String(f.get("building") ?? "").trim().slice(0, 500) || null;
    setSaving("busy");
    setErr(false);
    const { error } = await supabase.from("waitlist").update({ name, building }).eq("id", row.id);
    if (error) {
      setSaving("idle");
      return setErr(true);
    }
    setRow({ ...row, name, building });
    setSaving("saved");
  };

  const signOut = async () => {
    await supabase?.auth.signOut();
    router.replace("/");
  };

  const remove = async () => {
    if (!supabase || confirm.trim().toUpperCase() !== "DELETE") return;
    setErr(false);
    const { error } = await supabase.rpc("delete_my_account");
    if (error) return setErr(true);
    setDeleted(true);
    // The account is gone, so this only clears the session stored in the browser.
    await supabase.auth.signOut({ scope: "local" });
  };

  if (deleted) {
    return (
      <AuthShell title={c.leaveTitle}>
        <p className="form-note">{c.deleted}</p>
        <p className="form-foot" style={{ marginTop: 18 }}>
          <Link href="/">← {t.legal.home}</Link>
        </p>
      </AuthShell>
    );
  }

  if (!session || !row) {
    return (
      <AuthShell title={c.title}>
        {err ? <p className="form-error">{w.errors.generic}</p> : <p className="auth-lede">{c.loading}</p>}
      </AuthShell>
    );
  }

  const joined = new Date(row.created_at).toLocaleDateString(lang, { day: "numeric", month: "long", year: "numeric" });

  return (
    <AuthShell title={row.name ? fill(c.hi, { name: row.name }) : c.title} wide>
      <div className="acct-grid">
        {position && (
          <motion.div
            className="acct-pos"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
          >
            <span className="wl-num">#{position}</span>
            <p>
              <b>{fill(c.position, { n: position })}</b>
              <span>{c.positionHelp}</span>
            </p>
          </motion.div>
        )}

        <ReferralBox />

        <section className="acct-section" style={{ padding: 0 }}>
          <h2>{c.details}</h2>
          <form className="form" onSubmit={save} onChange={() => saving === "saved" && setSaving("idle")}>
            <Field label={w.name} name="name" defaultValue={row.name} autoComplete="name" required maxLength={100} />
            <Field label={w.email} value={row.email} disabled readOnly />
            <Field
              label={w.building}
              aside={w.optional}
              name="building"
              multiline
              maxLength={500}
              defaultValue={row.building ?? ""}
              placeholder={w.buildingPh}
            />
            {err && (
              <p className="form-error" role="alert">
                {w.errors.generic}
              </p>
            )}
            <div className="acct-row">
              <p className="acct-meta">
                {c.joined}: {joined}
              </p>
              <span className="acct-row" style={{ justifyContent: "flex-end" }}>
                {saving === "saved" && <span className="saved-tick">{c.saved}</span>}
                <button className="btn" type="submit" disabled={saving === "busy"}>
                  {saving === "busy" ? c.saving : c.save}
                </button>
              </span>
            </div>
          </form>
        </section>

        <div className="acct-row">
          <span />
          <button className="btn ghost" type="button" onClick={signOut}>
            {c.signOut}
          </button>
        </div>

        <section className="acct-section acct-danger">
          <h2>{c.leaveTitle}</h2>
          <p>{c.leaveBody}</p>
          <div className="form">
            <Field label={c.leaveConfirm} value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" />
            <button
              className="btn danger"
              type="button"
              disabled={confirm.trim().toUpperCase() !== "DELETE"}
              onClick={remove}
            >
              {c.leaveBtn}
            </button>
          </div>
        </section>
      </div>
    </AuthShell>
  );
}
