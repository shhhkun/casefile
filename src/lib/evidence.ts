import { ResolvedCase, ExtractedCase } from "./types";
import { ingestSource, retrieveChunks } from "./rag";
import type { RetrievedChunk, IngestInput } from "./rag";

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

/**
 * Ingest a single external search result into the RAG knowledge base.
 * Returns true if ingestion was attempted (regardless of reuse), false if
 * the result had no usable content.
 */
async function ingestSearchResult(input: IngestInput): Promise<boolean> {
  if (!input.sourceText || input.sourceText.trim().length === 0) {
    return false;
  }

  await ingestSource(input);
  return true;
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
      "Total evidence chars:",
      JSON.stringify(evidence).length,
      "≈",
      Math.ceil(JSON.stringify(evidence).length / 4),
      "tokens",
    );
  } catch (err) {
    console.error("Evidence fetch failed:", err);
  }

  // RAG: ingest top search results and retrieve relevant chunks.
  // This is additive and non-fatal — if RAG fails, normal evidence
  // assembly still succeeds. At most 2 external sources are ingested:
  // the #1 CourtListener result and the #1 Wikipedia result.
  try {
    const sourcesToIngest: IngestInput[] = [];

    // Top CourtListener result — ingest snippet as source text
    if (
      searchContext?.courtlistener?.url &&
      searchContext.courtlistener.snippet
    ) {
      sourcesToIngest.push({
        url: searchContext.courtlistener.url,
        sourceType: "article",
        title: searchContext.courtlistener.title,
        sourceText: searchContext.courtlistener.snippet,
        extractedMeta: {
          caseName: extracted.caseName,
          defendant: extracted.defendant,
          victim: extracted.victim,
          crimeType: extracted.crimeType,
          jurisdiction: extracted.jurisdiction,
          state: extracted.state,
          approximateYear: extracted.approximateYear,
          keywords: extracted.keywords,
          confidence: extracted.confidence,
        },
      });
    }

    // Top Wikipedia result — ingest summary as source text
    if (searchContext?.wikipedia?.url && searchContext.wikipedia.summary) {
      sourcesToIngest.push({
        url: searchContext.wikipedia.url,
        sourceType: "article",
        title: searchContext.wikipedia.title,
        sourceText: searchContext.wikipedia.summary,
        extractedMeta: {
          caseName: extracted.caseName,
          defendant: extracted.defendant,
          victim: extracted.victim,
          crimeType: extracted.crimeType,
          jurisdiction: extracted.jurisdiction,
          state: extracted.state,
          approximateYear: extracted.approximateYear,
          keywords: extracted.keywords,
          confidence: extracted.confidence,
        },
      });
    }

    // Ingest at most 2 external sources (top CourtListener + top Wikipedia)
    for (const input of sourcesToIngest.slice(0, 2)) {
      try {
        const ingested = await ingestSearchResult(input);
        if (ingested) {
          console.log(`RAG: ingested ${input.url}`);
        }
      } catch (err) {
        console.error(`RAG ingest failed for ${input.url}:`, err);
      }
    }

    // Retrieve a small topK set of relevant chunks from the knowledge base
    const queryText = buildRagQuery(extracted);
    if (queryText) {
      const chunks = await retrieveChunks(queryText, { topK: 5 });
      evidence.ragChunks = chunks;
      console.log(`RAG: retrieved ${chunks.length} chunks`);
    }
  } catch (err) {
    console.error("RAG retrieval failed:", err);
  }

  return evidence;
}
