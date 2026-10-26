"use client";

import Link from "next/link";
import { useLang } from "@/i18n/LangProvider";
import { WeaveLogo } from "./WeaveLogo";
import "./footer.css";

export function Footer() {
  const { t } = useLang();
  return (
    <footer className="footer">
      <div className="wrap ft-row">
        <Link className="ft-brand" href="/#top" aria-label="Weave home">
          <WeaveLogo play="none" />
        </Link>
        <nav className="ft-links" aria-label="Legal">
          <Link href="/privacy">{t.legal.privacy}</Link>
          <Link href="/terms">{t.legal.terms}</Link>
          <a href="mailto:buildwithweave@gmail.com">{t.footer.contact}</a>
        </nav>
        <p className="ft-small">© {new Date().getFullYear()} Weave</p>
      </div>
    </footer>
  );
}
