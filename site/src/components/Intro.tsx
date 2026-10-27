"use client";

import { animate, AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { DICTS, LANGS, storedLang, useLang, type Lang } from "@/i18n/LangProvider";
import { introStore } from "./introStore";
import { WeaveLogo } from "./WeaveLogo";
import "./intro.css";

const SEEN = "weave-intro";

type Phase = "draw" | "choose" | "fly";

/**
 * Full-screen opener: a thread writes "weave", the visitor picks a language
 * (first visit only), then the word flies up into the nav.
 */
export function Intro() {
  const { t, setLang } = useLang();
  const [gone, setGone] = useState(false);
  const [phase, setPhase] = useState<Phase>("draw");
  const [drawn, setDrawn] = useState(false);
  const logoRef = useRef<HTMLDivElement>(null);
  const bgRef = useRef<HTMLDivElement>(null);
  const restRef = useRef<HTMLDivElement>(null);
  const finishing = useRef(false);
  const askedLang = useRef(false);

  const finish = async (fast = false) => {
    if (finishing.current) return;
    finishing.current = true;
    setPhase("fly");
    const logo = logoRef.current;
    const bg = bgRef.current;
    const target = document.querySelector(".brand .weave-logo")?.getBoundingClientRect();
    if (logo && bg && target && !fast) {
      const from = logo.getBoundingClientRect();
      const dx = target.left + target.width / 2 - (from.left + from.width / 2);
      const dy = target.top + target.height / 2 - (from.top + from.height / 2);
      const s = target.width / from.width;
      const fades = [animate(bg, { opacity: 0 }, { duration: 0.7, delay: 0.25, ease: "easeOut" })];
      if (restRef.current) fades.push(animate(restRef.current, { opacity: 0, y: -8 }, { duration: 0.3 }));
      // Never leave the overlay up, even if an animation is interrupted.
      await Promise.race([
        Promise.all([animate(logo, { x: dx, y: dy, scale: s }, { duration: 0.9, ease: [0.7, 0, 0.2, 1] }), ...fades]),
        new Promise((r) => setTimeout(r, 1400)),
      ]);
    } else if (bg) {
      await Promise.race([animate(bg.parentElement!, { opacity: 0 }, { duration: 0.35 }), new Promise((r) => setTimeout(r, 600))]);
    }
    try {
      sessionStorage.setItem(SEEN, "1");
    } catch {}
    document.documentElement.style.overflow = "";
    introStore.set("played");
    setGone(true);
  };

  // Skipping still asks for a language if none has been picked yet.
  const skip = () => {
    if (finishing.current) return;
    if (storedLang()) finish(true);
    else setPhase("choose");
  };

  const pick = (l: Lang) => {
    setLang(l);
    // Let the page re-render in the new language before measuring the nav logo.
    requestAnimationFrame(() => requestAnimationFrame(() => finish()));
  };

  useEffect(() => {
    // Skip when the pre-paint script said so, or when arriving from another page of the site
    // with a language already chosen.
    if (document.documentElement.dataset.intro === "skip" || (introStore.get() !== "pending" && storedLang())) {
      introStore.set("skipped");
      setGone(true);
      return;
    }
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.documentElement.style.overflow = "";
    };
  }, []);

  useEffect(() => {
    if (phase === "choose") askedLang.current = true;
  }, [phase]);

  useEffect(() => {
    if (phase !== "draw") return;
    const onKey = () => skip();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    if (!drawn || phase !== "draw") return;
    const tm = setTimeout(() => (storedLang() ? finish() : setPhase("choose")), storedLang() ? 650 : 350);
    return () => clearTimeout(tm);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawn]);

  if (gone) return null;

  const choosing = phase === "choose";
  const chose = choosing || (phase === "fly" && askedLang.current);
  const showLangs = chose;
  const showTag = !chose;

  return (
    <div className={`intro${choosing ? " choosing" : ""}`} onClick={phase === "draw" ? skip : undefined}>
      <div className="intro-bg" ref={bgRef} />
      <div className={`intro-logo${chose ? " small" : ""}`} ref={logoRef}>
        <WeaveLogo
          key={phase === "draw" ? "draw" : "done"}
          play={phase === "draw" ? "mount" : "none"}
          duration={2.4}
          delay={0.3}
          onDrawn={() => setDrawn(true)}
        />
      </div>

      <div className="intro-rest" ref={restRef}>
      <AnimatePresence mode="wait">
        {showLangs ? (
          <motion.div
            key="langs"
            className="intro-langs"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
          >
            <ChooseTitle />
            <div className="intro-grid" role="listbox" aria-label="Choose your language">
              {LANGS.map((l, i) => (
                <motion.button
                  key={l.code}
                  role="option"
                  aria-selected={false}
                  className="intro-lang"
                  onClick={() => phase === "choose" && pick(l.code)}
                  initial={{ opacity: 0, y: 18, scale: 0.94 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ delay: 0.15 + i * 0.06, type: "spring", stiffness: 320, damping: 24 }}
                  whileHover={{ y: -2 }}
                  whileTap={{ scale: 0.96 }}
                >
                  <b lang={l.code}>{l.native}</b>
                  <small>{l.english}</small>
                </motion.button>
              ))}
            </div>
          </motion.div>
        ) : (
          showTag && (
            <motion.p
              key="tag"
              className="intro-tag"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ delay: 2, duration: 0.6 }}
            >
              {t.intro.tag}
            </motion.p>
          )
        )}
      </AnimatePresence>
      </div>
      {phase === "draw" && <span className="intro-skip">{t.intro.skip}</span>}
    </div>
  );
}

/** "Choose your language", cycling through every language on offer. */
function ChooseTitle() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setI((n) => (n + 1) % LANGS.length), 1600);
    return () => clearInterval(id);
  }, []);
  const l = LANGS[i];
  return (
    <div className="intro-choose" aria-live="off">
      <AnimatePresence mode="wait">
        <motion.p
          key={l.code}
          lang={l.code}
          initial={{ opacity: 0, y: 10, filter: "blur(4px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          exit={{ opacity: 0, y: -10, filter: "blur(4px)" }}
          transition={{ duration: 0.35 }}
        >
          {DICTS[l.code].intro.choose}
        </motion.p>
      </AnimatePresence>
    </div>
  );
}
