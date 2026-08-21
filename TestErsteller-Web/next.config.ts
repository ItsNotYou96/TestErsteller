import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["docx", "jszip", "pdf-parse"],
};

export default nextConfig;
