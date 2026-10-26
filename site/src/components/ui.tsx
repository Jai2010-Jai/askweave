"use client";

import { motion, useScroll, useSpring, type HTMLMotionProps } from "motion/react";
import type { ReactNode } from "react";

export const ease = [0.2, 0.7, 0.2, 1] as const;

type RevealProps = HTMLMotionProps<"div"> & {
  delay?: number;
  y?: number;
  blur?: boolean;
  children: ReactNode;
};

/** Fades and lifts content into place the first time it scrolls into view. */
export function Reveal({ delay = 0, y = 26, blur = false, children, ...rest }: RevealProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y, filter: blur ? "blur(8px)" : "blur(0px)" }}
      whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      viewport={{ once: true, margin: "0px 0px -12% 0px" }}
      transition={{ duration: 0.85, delay, ease }}
      {...rest}
    >
      {children}
    </motion.div>
  );
}

/** Wipes content in from left to right, like ink being written across the page. */
export function Write({ delay = 0, children, className }: { delay?: number; children: ReactNode; className?: string }) {
  return (
    <motion.div
      className={className}
      initial={{ clipPath: "inset(0 100% 0 0)", opacity: 0.4 }}
      whileInView={{ clipPath: "inset(0 0% 0 0)", opacity: 1 }}
      viewport={{ once: true, margin: "0px 0px -10% 0px" }}
      transition={{ duration: 1.1, delay, ease }}
    >
      {children}
    </motion.div>
  );
}

/** An SVG path that draws itself with a pen when it comes into view. */
export function InkPath({
  d,
  delay = 0,
  duration = 1.2,
  ...rest
}: { d: string; delay?: number; duration?: number } & React.SVGProps<SVGPathElement>) {
  return (
    <motion.path
      d={d}
      initial={{ pathLength: 0, opacity: 0 }}
      whileInView={{ pathLength: 1, opacity: 1 }}
      viewport={{ once: true }}
      transition={{ pathLength: { duration, delay, ease: "easeInOut" }, opacity: { duration: 0.01, delay } }}
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...(rest as object)}
    />
  );
}

/** A hand-drawn highlighter swipe behind a few words. */
export function Highlight({ children, delay = 0.2 }: { children: ReactNode; delay?: number }) {
  return (
    <span className="hl-wrap">
      <motion.span
        className="hl-swipe"
        initial={{ scaleX: 0 }}
        whileInView={{ scaleX: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 0.7, delay, ease }}
      />
      <span className="hl-text">{children}</span>
    </span>
  );
}

export function SectionHead({
  eyebrow,
  title,
  lede,
  center,
}: {
  eyebrow: string;
  title: ReactNode;
  lede?: ReactNode;
  center?: boolean;
}) {
  return (
    <div className={`section-head${center ? " center" : ""}`}>
      <Reveal>
        <p className="eyebrow">{eyebrow}</p>
      </Reveal>
      <Reveal delay={0.08} blur>
        <h2>{title}</h2>
      </Reveal>
      {lede && (
        <Reveal delay={0.16}>
          <p className="lede">{lede}</p>
        </Reveal>
      )}
    </div>
  );
}

/** A fountain-pen ink line across the top of the page that tracks scroll position. */
export function ScrollProgress() {
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, { stiffness: 140, damping: 30, mass: 0.4 });
  return <motion.div className="scroll-ink" style={{ scaleX }} aria-hidden />;
}
