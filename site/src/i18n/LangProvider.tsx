"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { en, type Dict } from "./en";
import { es } from "./es";
import { hi } from "./hi";
import { kn } from "./kn";
import { ta } from "./ta";
import { te } from "./te";

export const LANGS = [
  { code: "en", native: "English", english: "English", short: "EN" },
  { code: "hi", native: "हिन्दी", english: "Hindi", short: "हि" },
  { code: "te", native: "తెలుగు", english: "Telugu", short: "తె" },
  { code: "ta", native: "தமிழ்", english: "Tamil", short: "த" },
  { code: "kn", native: "ಕನ್ನಡ", english: "Kannada", short: "ಕ" },
  { code: "es", native: "Español", english: "Spanish", short: "ES" },
] as const;

export type Lang = (typeof LANGS)[number]["code"];

export const DICTS: Record<Lang, Dict> = { en, hi, te, ta, kn, es };
const KEY = "weave-lang";

export function storedLang(): Lang | null {
  try {
    const s = localStorage.getItem(KEY);
    return s && s in DICTS ? (s as Lang) : null;
  } catch {
    return null;
  }
}

type Ctx = { lang: Lang; t: Dict; setLang: (l: Lang) => void };
const LangCtx = createContext<Ctx>({ lang: "en", t: en, setLang: () => {} });

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>("en");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const s = storedLang();
    if (s) setLangState(s);
    setReady(true);
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
    // The page was hidden before paint while a saved language loaded; show it now.
    if (ready) document.documentElement.classList.remove("lang-pending");
  }, [lang, ready]);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem(KEY, l);
    } catch {}
  }, []);

  return <LangCtx.Provider value={{ lang, t: DICTS[lang], setLang }}>{children}</LangCtx.Provider>;
}

export const useLang = () => useContext(LangCtx);

/** Renders **bold** and `code` inside translated strings. */
export function Rich({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("**") ? (
          <b key={i}>{p.slice(2, -2)}</b>
        ) : p.startsWith("`") ? (
          <code key={i}>{p.slice(1, -1)}</code>
        ) : (
          p
        ),
      )}
    </>
  );
}
