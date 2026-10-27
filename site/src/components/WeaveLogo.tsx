"use client";

import { motion } from "motion/react";
import { useId, useState } from "react";
import { WEAVE_STROKES } from "./weavePath";
import "./weave-logo.css";

// Measured length of each stroke, so they can be written one after another at an even pace.
const LENGTHS = [348, 315, 835, 185, 738, 602];
const TOTAL = LENGTHS.reduce((a, b) => a + b, 0);
const STARTS = LENGTHS.map((_, i) => LENGTHS.slice(0, i).reduce((a, b) => a + b, 0) / TOTAL);

export const WEAVE_PATH = WEAVE_STROKES.join(" ");

type Play = "mount" | "view" | "none";

export function WeaveLogo({
  className,
  play = "view",
  duration = 1.8,
  delay = 0,
  onDrawn,
}: {
  className?: string;
  play?: Play;
  duration?: number;
  delay?: number;
  onDrawn?: () => void;
}) {
  const id = useId().replace(/:/g, "");
  const [run, setRun] = useState(0);

  const reveal =
    run > 0 || play === "mount"
      ? { animate: { pathLength: 1 } }
      : play === "view"
        ? { whileInView: { pathLength: 1 }, viewport: { once: true } }
        : {};

  return (
    <svg
      className={`weave-logo ${className ?? ""}`}
      viewBox="26 364 1224 186"
      role="img"
      aria-label="weave"
      onPointerEnter={() => setRun((r) => r + 1)}
    >
      <defs>
        {/* The thread is revealed along its own path, so it looks like it is being written. */}
        <mask id={`wl-${id}`} maskUnits="userSpaceOnUse" x="0" y="330" width="1300" height="260">
          {WEAVE_STROKES.map((d, i) => {
            const total = run > 0 ? 1.3 : duration;
            return (
              <motion.path
                key={`${run}-${i}`}
                d={d}
                fill="none"
                stroke="#fff"
                strokeWidth="40"
                strokeLinecap="round"
                strokeLinejoin="round"
                initial={{ pathLength: play === "none" && run === 0 ? 1 : 0, opacity: play === "none" && run === 0 ? 1 : 0 }}
                {...(reveal.animate
                  ? { animate: { pathLength: 1, opacity: 1 } }
                  : reveal.whileInView
                    ? { whileInView: { pathLength: 1, opacity: 1 }, viewport: { once: true } }
                    : {})}
                transition={{
                  pathLength: {
                    duration: (LENGTHS[i] / TOTAL) * total,
                    delay: (run > 0 ? 0 : delay) + STARTS[i] * total,
                    ease: "linear",
                  },
                  opacity: { duration: 0.01, delay: (run > 0 ? 0 : delay) + STARTS[i] * total },
                }}
                onAnimationComplete={i === WEAVE_STROKES.length - 1 ? onDrawn : undefined}
              />
            );
          })}
        </mask>
      </defs>
      <g mask={`url(#wl-${id})`}>
        <path d={WEAVE_PATH} className="wl-string" />
      </g>
    </svg>
  );
}
