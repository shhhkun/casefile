import { ResolvedCase, ExtractedCase } from "./types";
import {
  ingestSource,
  findReusableSource,
  retrieveChunks,
  fetchCourtListenerSource,
  fetchWikipediaSource,
  deleteExpiredSources,
} from "./rag";
import type { RetrievedChunk } from "./rag";

export interface Evidence {
  caseInfo?: {
    caseName: string | null;
    defendant: string | null;
    victim: string | null;
    crimeType: string | null;
    jurisdiction: string | null;
    state: string | null;
    approximateYear: string | null;
  };

  originalText?: string;

  wikipedia?: {
    title: string;
    text: string;
    url: string;
  };

  courtlistener?: {
    title: string;
    text: string;
    url: string;
    court?: string;
    dateFiled?: string;
  };

  /**
   * RAG-retrieved chunks from the shared knowledge base.
   * Populated during Evidence Assembly when top search results are
   * ingested and retrieved. Additive and non-fatal: may be empty if
   * RAG is unavailable or fails.
   */
  ragChunks?: RetrievedChunk[];
}

/**
 * The #1 CourtListener and #1 Wikipedia search results, preserved from
 * the search stage so that Evidence Assembly can use them as RAG sources.
 *
 * This is pipeline metadata only — it does not alter candidate resolution
 * or the resolved-case semantics. The existing resolver continues to choose
 * the resolved case exactly as it currently does.
 */
export interface SearchContext {
  courtlistener?: {
    title: string;
    url: string;
    snippet: string;
    court?: string;
    dateFiled?: string;
    /** CourtListener cluster id from the search result; used to resolve the
     *  underlying opinion record(s) via the Opinions API. */
    clusterId?: string;
  };
  wikipedia?: {
    title: string;
    url: string;
    summary: string;
  };
}

// Limit long text/transcript extractions to first 60% and last 40% of maxChars
function limitText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;

  const head = Math.floor(maxChars * 0.6);
  const tail = Math.floor(maxChars * 0.4);

  return text.slice(0, head) + "\n\n[Middle omitted]\n\n" + text.slice(-tail);
}

/**
 * Build a retrieval query string from the extracted case signals.
 * Used as the query text for RAG chunk retrieval.
 */
function buildRagQuery(extracted: ExtractedCase): string {
  const parts = [
    extracted.caseName,
    extracted.defendant,
    extracted.victim,
    extracted.crimeType,
    extracted.jurisdiction,
    extracted.state,
    extracted.approximateYear,
    ...(extracted.keywords ?? []),
  ].filter(Boolean);

  return parts.join(" ");
}

// Fetch full source documents for the resolved case
export async function fetchEvidence(
  resolved: ResolvedCase,
  extracted: ExtractedCase,
  originalText: string,
  searchContext?: SearchContext,
): Promise<Evidence> {
  const selected = resolved.selectedCase;

  // Always include original extracted input
  const evidence: Evidence = {
    caseInfo: {
      caseName: extracted.caseName,
      defendant: extracted.defendant,
      victim: extracted.victim,
      crimeType: extracted.crimeType,
      jurisdiction: extracted.jurisdiction,
      state: extracted.state,
      approximateYear: extracted.approximateYear,
    },
    originalText: limitText(originalText, 14000),
  };

  console.log("Evidence caseInfo:", JSON.stringify(evidence.caseInfo, null, 2));

  try {
    if (selected.source === "wikipedia" && selected.url) {
      const pageTitle = selected.url.split("/wiki/")[1];

      const res = await fetch(
        `https://en.wikipedia.org/api/rest_v1/page/summary/${pageTitle}`,
      );

      if (res.ok) {
        const data = await res.json();

        evidence.wikipedia = {
          title: data.title,
          text: limitText(data.extract, 6000),
          url: data.content_urls?.desktop?.page ?? selected.url,
        };
      }
    }

    if (selected.source === "courtlistener" && selected.url) {
      // CourtListener doesn't give full text easily via search API, so we reuse snippet as "evidence layer" for now

      evidence.courtlistener = {
        title: selected.title,
        text: selected.snippet ?? "", // 4000 limit once arg type fixed
        url: selected.url,
        court: selected.metadata?.court,
        dateFiled: selected.metadata?.dateFiled,
      };
    }
  } catch (err) {
    console.error("Evidence fetch failed:", err);
  }

  // RAG: ingest the full underlying documents of the top search results and
  // retrieve relevant chunks. This is additive and non-fatal.
  //
  // Before ingestion, remove any expired sources. This allows the existing
  // cleanup/TTL behavior to determine whether a source needs to be re-ingested.
  try {
    await deleteExpiredSources();

    const extractedMeta = {
      caseName: extracted.caseName,
      defendant: extracted.defendant,
      victim: extracted.victim,
      crimeType: extracted.crimeType,
      jurisdiction: extracted.jurisdiction,
      state: extracted.state,
      approximateYear: extracted.approximateYear,
      keywords: extracted.keywords,
      confidence: extracted.confidence,
    };

    // Top CourtListener result (opinion)
    if (searchContext?.courtlistener?.clusterId) {
      const clusterId = searchContext.courtlistener.clusterId;
      const sourceUrl = searchContext.courtlistener.url;

      // Cheap DB check FIRST
      const existing = await findReusableSource(sourceUrl);

      if (existing) {
        console.log(
          `RAG: CourtListener source reused — ${sourceUrl} ` +
            `(${existing.chunkCount} chunks)`,
        );
      } else {
        // Only hit CourtListener when the source is not already cached
        const source = await fetchCourtListenerSource(clusterId);

        if (source) {
          try {
            const result = await ingestSource({
              url: source.url,
              sourceType: source.sourceType,
              title: source.title,
              sourceText: source.sourceText,
              extractedMeta,
            });

            console.log(
              `RAG: CourtListener ${source.url} — ` +
                `${result.reused ? "reused existing source" : "ingested new source"}; ` +
                `${result.chunkCount} chunks`,
            );
          } catch (err) {
            console.error(
              `RAG: CourtListener ingest failed for ${source.url}:`,
              err,
            );
          }
        } else {
          console.error(
            `RAG: CourtListener source unavailable for cluster ${clusterId}; skipping`,
          );
        }
      }
    }

    // Top Wikipedia Result
    if (searchContext?.wikipedia?.title) {
      const wikipediaUrl = searchContext.wikipedia.url;

      // Cheap DB check FIRST
      const existing = await findReusableSource(wikipediaUrl);

      if (existing) {
        console.log(
          `RAG: Wikipedia source reused — ${wikipediaUrl} ` +
            `(${existing.chunkCount} chunks)`,
        );
      } else {
        // Only hit Wikipedia when the source is not already cached
        const source = await fetchWikipediaSource(
          searchContext.wikipedia.title,
          wikipediaUrl,
        );

        if (source) {
          try {
            const result = await ingestSource({
              url: source.url,
              sourceType: source.sourceType,
              title: source.title,
              sourceText: source.sourceText,
              extractedMeta,
            });

            console.log(
              `RAG: Wikipedia ${source.url} — ` +
                `${result.reused ? "reused existing source" : "ingested new source"}; ` +
                `${result.chunkCount} chunks`,
            );
          } catch (err) {
            console.error(
              `RAG: Wikipedia ingest failed for ${source.url}:`,
              err,
            );
          }
        } else {
          console.error(
            `RAG: Wikipedia source unavailable for ${searchContext.wikipedia.title}; skipping`,
          );
        }
      }
    }

    // Retrieve relevant chunks
    const queryText = buildRagQuery(extracted);

    if (queryText) {
      const chunks = await retrieveChunks(queryText, {
        topK: 3,
      });

      evidence.ragChunks = chunks;

      let ragChunksCount = 0;

      console.log(`RAG: retrieved ${chunks.length} chunks`);

      evidence.ragChunks.forEach((chunk, index) => {
        ragChunksCount += chunk.text.length;

        console.log(`===== RAG CHUNK ${index + 1} =====`);
        console.log(chunk);
        console.log(`===== END RAG CHUNK ${index + 1} =====`);
      });

      // Evidence-size diagnostics.
      console.log("Evidence sizes:");

      console.log(
        "Original text:",
        evidence.originalText?.length ?? 0,
        "chars",
        "≈",
        Math.ceil((evidence.originalText?.length ?? 0) / 4),
        "tokens",
      );

      console.log(
        "Wikipedia:",
        evidence.wikipedia?.text.length ?? 0,
        "chars",
        "≈",
        Math.ceil((evidence.wikipedia?.text.length ?? 0) / 4),
        "tokens",
      );

      console.log(
        "CourtListener:",
        evidence.courtlistener?.text.length ?? 0,
        "chars",
        "≈",
        Math.ceil((evidence.courtlistener?.text.length ?? 0) / 4),
        "tokens",
      );

      console.log(
        "RAG chunks:",
        ragChunksCount,
        "chars",
        "≈",
        Math.ceil(ragChunksCount / 4),
        "tokens",
      );

      const serializedEvidence = JSON.stringify(evidence);

      console.log(
        "Total evidence:",
        serializedEvidence.length,
        "chars",
        "≈",
        Math.ceil(serializedEvidence.length / 4),
        "tokens",
      );
    }
  } catch (err) {
    console.error("RAG retrieval failed:", err);
  }

  return evidence;
}
