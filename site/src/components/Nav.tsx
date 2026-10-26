"use client";

import Link from "next/link";
import { useMotionValueEvent, useScroll } from "motion/react";
import { useState } from "react";
import { LangMenu } from "./LangMenu";
import { WeaveLogo } from "./WeaveLogo";
import { useLang } from "@/i18n/LangProvider";
import { useSession } from "@/lib/supabase";
import "./nav.css";

/** The Weave mark: a white "w" on a green tile. */
export function BrandMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 64 64" aria-hidden>
      <rect width="64" height="64" rx="16" fill="var(--green-dark)" />
      <g transform="translate(-1.8 -46.5) scale(0.173)" fill="none" stroke="var(--mint)" strokeWidth="30" strokeLinecap="round" strokeLinejoin="round">
        <path d="M45 446 C 58 410, 72 383, 98 383 C 120 383, 130 400, 130 422 L 130 490 C 130 515, 145 531, 168 531 C 196 531, 220 515, 231 500" />
        <path d="M236 420 L 236 490 C 236 515, 252 531, 275 531 C 310 531, 341 492, 341 444 C 341 424, 332 402, 322 387" />
      </g>
    </svg>
  );
}

export function Nav() {
  const { scrollY } = useScroll();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const { t } = useLang();
  const session = useSession();
  const links = [
    { href: "/#how", label: t.nav.how },
    { href: "/#builders", label: t.nav.builds },
    { href: "/#changes", label: t.nav.looks },
  ];
  useMotionValueEvent(scrollY, "change", (v) => setScrolled(v > 12));
  const close = () => setOpen(false);

  return (
    <header className={`nav${scrolled ? " scrolled" : ""}`}>
      <div className="wrap nav-row">
        <Link className="brand" href="/#top" aria-label="Weave home">
          <WeaveLogo play="none" />
        </Link>
        <nav className={`nav-links${open ? " open" : ""}`} aria-label="Sections">
          {links.map((l) => (
            <a key={l.href} href={l.href} onClick={close}>
              {l.label}
            </a>
          ))}
          {session ? (
            <Link className="btn dark nav-cta" href="/account" onClick={close}>
              {t.nav.account}
            </Link>
          ) : (
            <>
              <Link className="nav-login" href="/login" onClick={close}>
                {t.nav.login}
              </Link>
              <Link className="btn dark nav-cta" href="/#waitlist" onClick={close}>
                {t.nav.cta}
              </Link>
            </>
          )}
        </nav>
        <div className="nav-tools">
          <LangMenu />
          <button className="nav-burger" aria-label={t.nav.menu} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            <span />
            <span />
          </button>
        </div>
      </div>
    </header>
  );
}
