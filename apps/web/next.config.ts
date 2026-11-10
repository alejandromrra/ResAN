import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: ["@resan/shared"],
  reactStrictMode: true,
};

export default config;
