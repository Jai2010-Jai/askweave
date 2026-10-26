"use client";

import { IconMic, IconPhone, IconWrench } from "./icons";
import { Reveal } from "./ui";
import { useLang } from "@/i18n/LangProvider";
import "./how.css";

const icons = [IconMic, IconWrench, IconPhone];

export function HowItWorks() {
  const { t } = useLang();
  const h = t.how;
  return (
    <section id="how" className="how">
      <div className="wrap">
        <Reveal>
          <p className="label">{h.label}</p>
          <h2>{h.title}</h2>
        </Reveal>
        <div className="how-grid">
          {h.steps.map((s, i) => {
            const Icon = icons[i];
            return (
              <Reveal key={i} delay={i * 0.1} className="how-card">
                <div className="how-top">
                  <span className="how-num">{String(i + 1).padStart(2, "0")}</span>
                  <Icon />
                </div>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}
