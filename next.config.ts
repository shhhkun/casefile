import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep @huggingface/transformers external so Turbopack doesn't try to
  // bundle/scan the native onnxruntime-node it depends on at build time.
  // NOTE: the top-level `onnxruntime-node` dependency is NOT imported by any
  // app code — transformers.js resolves onnxruntime to its OWN nested copy
  // (node_modules/@huggingface/transformers/node_modules/onnxruntime-node),
  // so it is intentionally absent from this list.
  serverExternalPackages: ["@huggingface/transformers"],

  // Force the native .so binary that /api/analyze actually uses into the
  // serverless function bundle. Without this, Vercel's file tracing omits the
  // binary and the function fails at runtime with "libonnxruntime.so.1: cannot
  // open shared object file".
  //
  // Point the glob at the NESTED onnxruntime-node copy (the one transformers.js
  // imports), and only the linux/x64 platform that Vercel functions run on.
  // This avoids shipping ~259 MB of unused darwin/win32 binaries and the
  // redundant top-level @1.27.0 copy into Functions Storage.
  outputFileTracingIncludes: {
    "/api/analyze": [
      "./node_modules/@huggingface/transformers/node_modules/onnxruntime-node/bin/napi-v6/linux/x64/**/*",
    ],
  },
};

export default nextConfig;
