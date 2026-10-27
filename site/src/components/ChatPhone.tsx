"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { useLang } from "@/i18n/LangProvider";
import { BrandMark } from "./Nav";
import { IconCheck, IconDownload, IconPlay } from "./icons";
import "./chat-phone.css";

const STEPS = 6; // messages in the conversation
const BARS = [5, 9, 13, 8, 15, 11, 6, 12, 16, 10, 7, 13, 9, 14, 6, 11, 8];

/** A WhatsApp-style chat with Weave that plays out once, then replays. */
export function ChatPhone() {
  const { t } = useLang();
  const c = t.chat;
  const [shown, setShown] = useState(0);

  useEffect(() => {
    const id = setTimeout(() => setShown((n) => (n >= STEPS + 3 ? 0 : n + 1)), shown === 0 ? 500 : shown >= STEPS ? 1800 : 1100);
    return () => clearTimeout(id);
  }, [shown]);

  const msgs = [
    <div key="v" className="cp-row me">
      <div className="cp-bubble me cp-voice">
        <span className="cp-play"><IconPlay /></span>
        <span className="cp-wave">{BARS.map((h, i) => <i key={i} style={{ height: h }} />)}</span>
        <small>0:06</small>
      </div>
      <p className="cp-caption">{c.voiceCaption}</p>
    </div>,
    <div key="b1" className="cp-bubble bot">{c.bot1}</div>,
    <div key="s" className="cp-bubble bot cp-steps">
      {c.steps.map((s) => (
        <span key={s}><IconCheck /> {s}</span>
      ))}
    </div>,
    <div key="a" className="cp-bubble bot cp-app">
      <div className="cp-app-head">
        <span className="cp-app-ico"><IconCheck /></span>
        <span>
          <b>{c.appName}</b>
          <small>{c.appMeta}</small>
        </span>
      </div>
      <span className="cp-app-install"><IconDownload /> {c.install}</span>
    </div>,
    <div key="m2" className="cp-row me"><div className="cp-bubble me">{c.me2}</div></div>,
    <div key="b2" className="cp-bubble bot">{c.bot2}</div>,
  ];

  return (
    <div className="cp">
      <div className="cp-head">
        <span className="cp-avatar"><BrandMark /></span>
        <span className="cp-who">
          <b>{c.name}</b>
          <small>{c.status}</small>
        </span>
      </div>
      <div className="cp-body">
        <AnimatePresence initial={false}>
          {msgs.slice(0, Math.min(shown, STEPS)).map((m) => (
            <motion.div
              key={m.key}
              layout
              initial={{ opacity: 0, y: 14, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, transition: { duration: 0.2 } }}
              transition={{ type: "spring", stiffness: 380, damping: 32 }}
              className="cp-item"
            >
              {m}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
