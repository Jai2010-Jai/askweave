"use client";

import { motion } from "motion/react";
import { ChatPhone } from "./ChatPhone";
import { useIntro } from "./introStore";
import { IconArrow, IconChat, IconCheck } from "./icons";
import { ease } from "./ui";
import { useLang } from "@/i18n/LangProvider";
import "./hero.css";

export function Hero() {
  const { t, lang } = useLang();
  const h = t.hero;
  // Replay the entrance once the intro has finished.
  const ready = useIntro() !== "pending";
  const rise = (delay: number) => ({
    initial: { opacity: 0, y: 16 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.7, delay, ease },
  });

  return (
    <section className="hero" id="top">
      <div className="wrap hero-grid" key={`${ready}-${lang}`}>
        <div className="hero-copy">
          <motion.p className="hero-pill" {...rise(0.05)}>
            <IconChat /> {h.pill}
          </motion.p>
          <motion.h1 className="hero-title" {...rise(0.12)}>
            {h.title}
          </motion.h1>
          <motion.p className="hero-lede" {...rise(0.22)}>
            {h.lede}
          </motion.p>
          <motion.div className="hero-ctas" {...rise(0.32)}>
            <a className="btn" href="#waitlist">
              {h.cta} <IconArrow />
            </a>
            <a className="btn ghost" href="#how">
              {h.ctaHow}
            </a>
          </motion.div>
          <motion.ul className="hero-checks" {...rise(0.42)}>
            {h.chips.map((c) => (
              <li key={c}>
                <IconCheck /> {c}
              </li>
            ))}
          </motion.ul>
        </div>
        <motion.div
          className="hero-phone"
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9, delay: 0.3, ease }}
        >
          <ChatPhone />
        </motion.div>
      </div>
    </section>
  );
}
