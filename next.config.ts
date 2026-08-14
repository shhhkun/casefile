import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep the native onnxruntime-node binary external so Turbopack doesn't
  // try to bundle/scan it at build time.
  serverExternalPackages: ["@huggingface/transformers", "onnxruntime-node"],

  // Force the native .so binary into the /api/analyze serverless function
  // bundle. Without this, Vercel's file tracing omits the binary and the
  // function fails at runtime with "libonnxruntime.so.1: cannot open shared
  // object file".
  outputFileTracingIncludes: {
    "/api/analyze": ["./node_modules/onnxruntime-node/bin/**/*"],
  },
};

export default nextConfig;
