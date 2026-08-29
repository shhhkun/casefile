export interface RagSource {
  id: string;
  url: string;
  sourceType: "youtube" | "article";
  title: string | null;
  sourceText: string;
  extractedMeta: Record<string, unknown> | null;
  ingestedAt: string;
  expiresAt: string;
}

export interface RagChunk {
  id: string;
  sourceId: string;
  chunkIndex: number;
  text: string;
  charStart: number | null;
  charEnd: number | null;
  tokenCount: number | null;
}

export interface RagEmbedding {
  id: string;
  chunkId: string;
  model: string;
  dimensions: number;
  vector: number[];
}

export interface RetrievedChunk {
  chunkId: string;
  sourceId: string;
  sourceUrl: string;
  sourceType: "youtube" | "article";
  chunkIndex: number;
  text: string;
  similarity: number;
}

export interface IngestInput {
  url: string;
  sourceType: "youtube" | "article";
  title?: string | null;
  sourceText: string;
  extractedMeta?: Record<string, unknown> | null;
  expiresAt?: Date;
}

export interface IngestResult {
  sourceId: string;
  chunkCount: number;
  reused: boolean;
}

export interface FetchedSource {
  url: string;
  sourceType: "youtube" | "article";
  title: string | null;
  sourceText: string;
}
