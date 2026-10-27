"use client";

import { motion } from "motion/react";
import { Reveal } from "./ui";
import { useLang } from "@/i18n/LangProvider";
import "./changes.css";

export function Changes() {
  const { t } = useLang();
  const c = t.changes;
  return (
    <section id="changes" className="changes">
      <div className="wrap ch-grid">
        <Reveal>
          <p className="label">{c.label}</p>
          <h2>{c.title}</h2>
          <p className="ch-body">{c.body}</p>
        </Reveal>
        <ul className="ch-chips">
          {c.chips.map((x, i) => (
            <motion.li
              key={x}
              initial={{ opacity: 0, y: 10, scale: 0.95 }}
              whileInView={{ opacity: 1, y: 0, scale: 1 }}
              viewport={{ once: true, margin: "-10% 0px" }}
              transition={{ delay: 0.15 + i * 0.07, type: "spring", stiffness: 300, damping: 24 }}
            >
              {x}
            </motion.li>
          ))}
        </ul>
      </div>
    </section>
  );
}
