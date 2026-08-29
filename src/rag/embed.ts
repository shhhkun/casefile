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

// Inference is run in bounded sequential batches. This bounds the size of the
// ONNX input tensor / intermediate activations and output tensor held in
// memory at any one time for long documents (instead of embedding every chunk
// of a document in one large call). The OUTPUT is unchanged — callers still
// receive the full `number[][]` for all texts and persist them via the existing
// batched database inserts.
const EMBEDDING_BATCH_SIZE = 16;

// Module-level singleton so the model is reused across warm serverless
// invocations (avoids reloading weights on every request).
let extractorPromise: Promise<FeatureExtractionPipeline> | null = null;

function getExtractor(): Promise<FeatureExtractionPipeline> {
  if (!extractorPromise) {
    extractorPromise = pipeline(
      "feature-extraction",
      EMBEDDING_MODEL_LOAD_ID,
      // Load the int8 quantized weights (`onnx/model_quantized.onnx`, ~23 MB)
      // instead of the default fp32 `onnx/model.onnx` (~90 MB). This cuts the
      // model footprint ~4x without changing the stored embedding model id.
      { dtype: "q8" },
    ) as Promise<FeatureExtractionPipeline>;
  }
  return extractorPromise;
}

/**
 * Encode a single text into a normalized 384-dim embedding vector.
 */
export async function embedText(text: string): Promise<number[]> {
  const extractor = await getExtractor();

  const output = await extractor(text, {
    pooling: "mean",
    normalize: true,
  });

  // output is a Tensor with shape [1, dims]
  const nested = output.tolist() as number[][];
  return nested[0];
}

/**
 * Generate embeddings for multiple texts. Useful for ingesting chunk
 * embeddings. Texts are embedded in bounded sequential batches of up to
 * `EMBEDDING_BATCH_SIZE` (16); the resulting vectors are concatenated into a
 * single returned array so callers can persist them with their existing
 * batched database inserts.
 */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  const extractor = await getExtractor();

  const embeddings: number[][] = [];

  for (let i = 0; i < texts.length; i += EMBEDDING_BATCH_SIZE) {
    const batch = texts.slice(i, i + EMBEDDING_BATCH_SIZE);

    const output = await extractor(batch, {
      pooling: "mean",
      normalize: true,
    });

    // output is a Tensor with shape [batchSize, dims]
    const nested = output.tolist() as number[][];
    embeddings.push(...nested);
  }

  return embeddings;
}
