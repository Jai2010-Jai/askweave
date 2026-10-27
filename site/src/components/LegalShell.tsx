"use client";

import Link from "next/link";
import { useEffect, type ReactNode } from "react";
import { useLang } from "@/i18n/LangProvider";
import { Footer } from "./Footer";
import { introStore } from "./introStore";
import { Nav } from "./Nav";
import { Reveal } from "./ui";
import "./legal.css";

/** Page frame for the Privacy Policy and Terms. The legal text itself is English only. */
export function LegalShell({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  const { t } = useLang();

  // There is no intro on these pages, so show the nav logo straight away.
  useEffect(() => {
    if (introStore.get() === "pending") introStore.set("skipped");
  }, []);

  return (
    <>
      <Nav />
      <main className="legal">
        <div className="wrap legal-wrap">
          <Link className="legal-back" href="/">
            ← {t.legal.home}
          </Link>
          <Reveal className="sheet legal-sheet">
            <p className="eyebrow">Weave</p>
            <h1 className="legal-title">{title}</h1>
            <p className="legal-updated">Last updated: {updated}</p>
            {t.legal.englishOnly && <p className="legal-note">{t.legal.englishOnly}</p>}
            <div className="legal-body" lang="en">
              {children}
            </div>
          </Reveal>
        </div>
      </main>
      <Footer />
    </>
  );
}
