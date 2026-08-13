import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Forces Turbopack to stop scanning both packages for binary modules at build-time
  serverExternalPackages: ["@huggingface/transformers", "onnxruntime-node"],

  turbopack: {
    resolveAlias: {
      "onnxruntime-node": "onnxruntime-web",
    },
  },
};

export default nextConfig;
