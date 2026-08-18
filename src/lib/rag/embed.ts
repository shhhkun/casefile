import {
  env,
  pipeline,
  FeatureExtractionPipeline,
} from "@huggingface/transformers";

env.allowLocalModels = false;
env.cacheDir = "/tmp/huggingface_cache";

// Model ID used to *load* the weights from Hugging Face Hub (Transformers.js).
const EMBEDDING_MODEL_LOAD_ID = "Xenova/all-MiniLM-L6-v2";

// Canonical model identifier stored in rag_embeddings.model and used in
// retrieval filters. This is the SAME string across TS and Python so
// cross-language ingestion/retrieval works. The model weights are identical
// (all-MiniLM-L6-v2, 384-dim) — only the module-loading ID differs per
// runtime.
export const EMBEDDING_MODEL = "all-MiniLM-L6-v2";
export const EMBEDDING_DIMENSIONS = 384;

// Module-level singleton so the model is reused across warm serverless
// invocations (avoids reloading weights on every request).
let extractorPromise: Promise<FeatureExtractionPipeline> | null = null;

function getExtractor(): Promise<FeatureExtractionPipeline> {
  if (!extractorPromise) {
    extractorPromise = pipeline(
      "feature-extraction",
      EMBEDDING_MODEL_LOAD_ID,
    ) as Promise<FeatureExtractionPipeline>;
  }
  return extractorPromise;
}

/**
 * Generate a single normalized embedding vector for the given text using
 * the local Transformers.js model. Zero API cost, no external embedding
 * service dependency.
 */
export async function embedText(text: string): Promise<number[]> {
  const extractor = await getExtractor();

  const output = await extractor(text, {
    pooling: "mean",
    normalize: true,
  });

  // output is a Tensor with shape [1, dims].
  const nested = output.tolist() as number[][];
  return nested[0];
}

/**
 * Generate embeddings for multiple texts in a single call. Useful for
 * batching chunk embeddings during ingestion.
 */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  const extractor = await getExtractor();

  const output = await extractor(texts, {
    pooling: "mean",
    normalize: true,
  });

  // output is a Tensor with shape [numTexts, dims].
  return output.tolist() as number[][];
}
