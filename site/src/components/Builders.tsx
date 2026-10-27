"use client";

import { IconPhone, IconWeb } from "./icons";
import { Reveal } from "./ui";
import { useLang } from "@/i18n/LangProvider";
import "./builders.css";

export function Builders() {
  const { t } = useLang();
  const b = t.builders;
  return (
    <section id="builders" className="builders">
      <div className="wrap">
        <Reveal>
          <p className="label">{b.label}</p>
          <h2>{b.title}</h2>
        </Reveal>
        <div className="b-grid">
          <Reveal className="b-card b-android">
            <span className="b-ico"><IconPhone /></span>
            <h3>{b.android.title}</h3>
            <p>{b.android.body}</p>
            <p className="b-tags">{b.android.tags}</p>
          </Reveal>
          <Reveal className="b-card b-web" delay={0.1}>
            <span className="b-ico"><IconWeb /></span>
            <h3>{b.web.title}</h3>
            <p>{b.web.body}</p>
            <div className="b-publish">
              <span>{b.web.publish}</span>
              <code>PUBLISH</code>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
