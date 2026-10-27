import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The site is fully static, so it is exported as plain files for Netlify.
  output: "export",
  images: { unoptimized: true },
};

export default nextConfig;
