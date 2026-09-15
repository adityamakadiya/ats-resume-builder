import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The repo sits inside a home directory that contains other lockfiles;
  // pin the root so Turbopack does not walk up and pick one of them up.
  turbopack: { root: __dirname },
  serverExternalPackages: ["@react-pdf/renderer", "unpdf", "mammoth"],
};

export default nextConfig;
