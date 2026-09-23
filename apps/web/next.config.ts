import { join } from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /*
    The repo sits inside a home directory that contains other lockfiles, so
    the root has to be pinned or Turbopack walks up and picks one of them up.

    It is pinned to the REPOSITORY root rather than to apps/web: this app
    imports `@ats/templates`, which npm installs as a symlink to
    ../../packages/templates. With the root at apps/web, everything behind
    that symlink is outside the resolution root and every import of the
    package and its print.css fails with "Module not found".
  */
  turbopack: { root: join(__dirname, "..", "..") },
  serverExternalPackages: ["@react-pdf/renderer", "unpdf", "mammoth"],
};

export default nextConfig;
