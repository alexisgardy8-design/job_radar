import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Le CV PDF passe par une Server Action : on relève la limite par défaut (1 Mo).
  experimental: { serverActions: { bodySizeLimit: "6mb" } },
};

export default nextConfig;
