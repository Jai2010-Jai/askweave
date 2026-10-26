"use client";

import { useEffect, type ReactNode } from "react";
import { Footer } from "../Footer";
import { introStore } from "../introStore";
import { Nav } from "../Nav";
import { Reveal } from "../ui";
import "./auth.css";

/** Page frame for log in, password reset and the account page. */
export function AuthShell({ title, lede, wide, children }: { title: ReactNode; lede?: ReactNode; wide?: boolean; children: ReactNode }) {
  // There is no intro on these pages, so show the nav logo straight away.
  useEffect(() => {
    if (introStore.get() === "pending") introStore.set("skipped");
  }, []);

  return (
    <>
      <Nav />
      <main className="auth">
        <div className={`wrap auth-wrap${wide ? " wide" : ""}`}>
          <Reveal className="sheet auth-sheet">
            <h1 className="auth-title">{title}</h1>
            {lede && <p className="auth-lede">{lede}</p>}
            {children}
          </Reveal>
        </div>
      </main>
      <Footer />
    </>
  );
}
