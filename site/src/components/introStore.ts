"use client";

import { useSyncExternalStore } from "react";

/** "pending" while the intro plays, "played" after it, "skipped" when it never ran this visit. */
export type IntroState = "pending" | "played" | "skipped";

let state: IntroState = "pending";
const subs = new Set<() => void>();

export const introStore = {
  get: () => state,
  set(next: IntroState) {
    state = next;
    subs.forEach((f) => f());
  },
  sub(f: () => void) {
    subs.add(f);
    return () => {
      subs.delete(f);
    };
  },
};

export function useIntro() {
  return useSyncExternalStore(introStore.sub, introStore.get, () => "pending" as IntroState);
}
