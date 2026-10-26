import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement>;
const base = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" } as const;

export const Logo = (p: P) => (
  <svg viewBox="0 0 24 24" aria-hidden {...p}>
    <path d="M12 2l2.4 6.8L21 11l-6.6 2.2L12 20l-2.4-6.8L3 11l6.6-2.2z" fill="var(--blue)" />
    <circle cx="19" cy="4" r="1.6" fill="var(--red)" />
  </svg>
);

export const IconChat = (p: P) => (
  <svg {...base} {...p}><path d="M4 18.5l1.3-3.6A7.5 7.5 0 1 1 9 18.6z" /><path d="M9 10.5h6M9 13.5h3.5" /></svg>
);
export const IconSms = (p: P) => (
  <svg {...base} {...p}><rect x="6.5" y="2.5" width="11" height="19" rx="2.5" /><path d="M10.5 18.5h3" /><path d="M9.5 7.5h5M9.5 10.5h3" /></svg>
);
export const IconWeb = (p: P) => (
  <svg {...base} {...p}><rect x="3" y="4" width="18" height="14" rx="2.5" /><path d="M3 8h18" /><path d="M7 21h10" /><circle cx="6" cy="6" r=".3" /></svg>
);
export const IconMic = (p: P) => (
  <svg {...base} {...p}><rect x="9" y="2.5" width="6" height="11.5" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0" /><path d="M12 17.5v4" /></svg>
);
export const IconDesk = (p: P) => (
  <svg {...base} {...p}><rect x="2.5" y="3.5" width="19" height="13" rx="2" /><path d="M8 20.5h8M12 16.5v4" /><path d="M6 12l3-3 2.5 2 4.5-4.5" /></svg>
);
export const IconQr = (p: P) => (
  <svg {...base} {...p}><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><path d="M14 14h3v3M21 14v.01M17 21h4v-4M14 18v3" /></svg>
);
export const IconAndroid = (p: P) => (
  <svg {...base} {...p}><rect x="6" y="2.5" width="12" height="19" rx="2.6" /><path d="M10.5 5h3" /><path d="M9 11.5l2 2 4-4" /></svg>
);
export const IconKey = (p: P) => (
  <svg {...base} {...p}><circle cx="8" cy="15" r="4.5" /><path d="M11.2 11.8L20 3M16.5 6.5l2.5 2.5M14.5 8.5l2 2" /></svg>
);
export const IconShield = (p: P) => (
  <svg {...base} {...p}><path d="M12 2.8l7.5 3v6c0 4.6-3.2 8-7.5 9.4C7.7 19.8 4.5 16.4 4.5 11.8v-6z" /><path d="M8.8 12l2.2 2.2 4.4-4.6" /></svg>
);
export const IconCheck = (p: P) => (
  <svg {...base} strokeWidth={2.4} {...p}><path d="M5 12.5l4.5 4.5L19 7" /></svg>
);
export const IconLock = (p: P) => (
  <svg {...base} {...p}><rect x="4.5" y="10.5" width="15" height="10.5" rx="2" /><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" /></svg>
);
export const IconLink = (p: P) => (
  <svg {...base} {...p}><path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1" /><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1" /></svg>
);
export const IconUpload = (p: P) => (
  <svg {...base} {...p}><path d="M12 16V4M7 9l5-5 5 5" /><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" /></svg>
);
export const IconArrow = (p: P) => (
  <svg {...base} strokeWidth={2.2} {...p}><path d="M4 12h15M13 6l6 6-6 6" /></svg>
);
export const IconCopy = (p: P) => (
  <svg {...base} {...p}><rect x="8.5" y="8.5" width="12" height="12" rx="2" /><path d="M15.5 8.5V5.5a2 2 0 0 0-2-2h-8a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h3" /></svg>
);
export const IconTest = (p: P) => (
  <svg {...base} {...p}><path d="M9 3h6M10 3v6.5L4.8 18.3A1.8 1.8 0 0 0 6.4 21h11.2a1.8 1.8 0 0 0 1.6-2.7L14 9.5V3" /><path d="M7.5 15h9" /></svg>
);
export const IconDownload = (p: P) => (
  <svg {...base} {...p}><path d="M12 4v12M7 11l5 5 5-5" /><path d="M4 20h16" /></svg>
);
export const IconWrench = (p: P) => (
  <svg {...base} {...p}><path d="M14.7 6.3a4 4 0 0 0-5.4 5.2L3.6 17.2a1.6 1.6 0 0 0 2.3 2.3l5.7-5.7a4 4 0 0 0 5.2-5.4l-2.5 2.5-2.1-.5-.5-2.1z" /></svg>
);
export const IconPhone = (p: P) => (
  <svg {...base} {...p}><rect x="6" y="2.5" width="12" height="19" rx="2.5" /><path d="M10.5 18.5h3" /></svg>
);
export const IconPlay = (p: P) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden {...p}><path d="M8 5.5v13l10.5-6.5z" /></svg>
);
