import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  turbopack: { root: "/Users/apple/ats-resume-builder" },
  serverExternalPackages: ["@react-pdf/renderer", "unpdf", "mammoth"],
};
export default nextConfig;
