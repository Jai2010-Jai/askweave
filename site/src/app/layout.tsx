import type { Metadata, Viewport } from "next";
import {
  Geist,
  Geist_Mono,
  Bricolage_Grotesque,
  Noto_Sans_Devanagari,
  Noto_Sans_Kannada,
  Noto_Sans_Tamil,
  Noto_Sans_Telugu,
} from "next/font/google";
import { LangProvider } from "@/i18n/LangProvider";
import "./globals.css";

const sans = Geist({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap" });
const display = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-display", display: "swap" });
// Indian scripts. The browser only downloads these when a page actually shows those characters.
const deva = Noto_Sans_Devanagari({ subsets: ["devanagari"], variable: "--font-deva", display: "swap", preload: false });
const telu = Noto_Sans_Telugu({ subsets: ["telugu"], variable: "--font-telu", display: "swap", preload: false });
const taml = Noto_Sans_Tamil({ subsets: ["tamil"], variable: "--font-taml", display: "swap", preload: false });
const knda = Noto_Sans_Kannada({ subsets: ["kannada"], variable: "--font-knda", display: "swap", preload: false });
const fonts = [sans, mono, display, deva, telu, taml, knda].map((f) => f.variable).join(" ");

const description =
  "Weave lives in your WhatsApp. Message it what you want and get back a real Android app or a finished website, right in the chat.";

export const metadata: Metadata = {
  metadataBase: new URL("https://askweave.xyz"),
  title: "Weave: WhatsApp it, get the real thing",
  description,
  applicationName: "Weave",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: "/",
    siteName: "Weave",
    title: "Weave: WhatsApp it, get the real thing",
    description,
  },
  twitter: { card: "summary_large_image", title: "Weave: WhatsApp it, get the real thing", description },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f1ea" },
  ],
};

// Before first paint: decide whether the intro runs, and hide the page
// while a saved non-English language loads, so there is no flash of the wrong one.
const themeScript = `document.documentElement.dataset.theme="light";try{var d=document.documentElement,l=localStorage.getItem("weave-lang");if(l&&(sessionStorage.getItem("weave-intro")||matchMedia("(prefers-reduced-motion: reduce)").matches))d.dataset.intro="skip";if(l&&l!=="en"){d.lang=l;d.classList.add("lang-pending");setTimeout(function(){d.classList.remove("lang-pending")},2500)}}catch(e){}`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={fonts} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <LangProvider>{children}</LangProvider>
      </body>
    </html>
  );
}
