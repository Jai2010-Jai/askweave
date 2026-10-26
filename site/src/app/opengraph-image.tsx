import { ImageResponse } from "next/og";
import { WEAVE_STROKES } from "@/components/weavePath";

// The preview card shown when the site is shared on WhatsApp, X, LinkedIn and so on.
export const dynamic = "force-static";
export const alt = "Weave: WhatsApp it, get the real thing";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "#fafaf9",
          color: "#0a0a0a",
          gap: 36,
        }}
      >
        <svg width="760" height="116" viewBox="26 364 1224 186">
          {WEAVE_STROKES.map((d, i) => (
            <path key={i} d={d} fill="none" stroke="#0a0a0a" strokeWidth="26" strokeLinecap="round" strokeLinejoin="round" />
          ))}
        </svg>
        <div style={{ display: "flex", fontSize: 56, fontWeight: 600, letterSpacing: -2 }}>
          WhatsApp it.&nbsp;<span style={{ color: "#8a8a8a" }}>Get the real thing.</span>
        </div>
        <div style={{ display: "flex", fontSize: 26, color: "#525252" }}>
          Message what you want. Get a real Android app or a finished website, right in the chat.
        </div>
      </div>
    ),
    size,
  );
}
