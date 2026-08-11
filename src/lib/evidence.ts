import * as cheerio from "cheerio";
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
 * Normalize HTML into plain readable text for RAG ingestion. Uses the same
 * Cheerio approach as article extraction: drop noise tags, then extract the
 * body text with whitespace collapsed.
 */
function htmlToText(html: string): string {
  const $ = cheerio.load(html);
  // Remove obvious noise / metadata blocks
  $("script, style, nav, footer, header, aside, form").remove();
  const text = $("body").text().replace(/\s+/g, " ").trim();
  return text;
}

/**
 * Fetch the full CourtListener opinion text for a cluster.
 *
 * CourtListener search results are opinion clusters; their `sub_opinions`
 * identify the underlying opinion record(s). We resolve the cluster via the
 * Clusters API to find the first opinion id, then fetch that opinion through
 * the Opinions API. `html_with_citations` is preferred as the source text,
 * then normalized to readable plain text. May return empty string on any
 * missing/failed step — callers treat that as "no usable RAG content".
 */
async function fetchCourtListenerFullText(
  clusterId: string,
): Promise<{ text: string; opinionUrl: string }> {
  const empty: { text: string; opinionUrl: string } = {
    text: "",
    opinionUrl: "",
  };

  try {
    // 1. Resolve the cluster to find its underlying opinions.
    const clusterRes = await fetch(
      `https://www.courtlistener.com/api/rest/v4/clusters/${clusterId}/`,
      { headers: { Accept: "application/json" } },
    );
    if (!clusterRes.ok) {
      console.error(
        `CL: cluster fetch failed (${clusterRes.status}) for ${clusterId}`,
      );
      return empty;
    }
    const cluster = await clusterRes.json();
    const subOpinions = cluster.sub_opinions ?? [];
    const firstOpinionId = subOpinions[0] as number | undefined;
    if (!firstOpinionId) {
      console.error(`CL: no sub_opinions found for cluster ${clusterId}`);
      return empty;
    }

    // 2. Fetch the opinion record; prefer html_with_citations.
    const opinionRes = await fetch(
      `https://www.courtlistener.com/api/rest/v4/opinions/${firstOpinionId}/`,
      { headers: { Accept: "application/json" } },
    );
    if (!opinionRes.ok) {
      console.error(
        `CL: opinion fetch failed (${opinionRes.status}) for ${firstOpinionId}`,
      );
      return empty;
    }
    const opinion = await opinionRes.json();
    const html = opinion.html_with_citations ?? opinion.html ?? "";
    if (!html) {
      console.error(
        `CL: opinion ${firstOpinionId} has no html_with_citations/html`,
      );
      return empty;
    }

    const text = htmlToText(html);
    const opinionUrl = opinion.absolute_url
      ? `https://www.courtlistener.com${opinion.absolute_url}`
      : "";
    return { text, opinionUrl };
  } catch (err) {
    console.error(`CL: full-text fetch failed for cluster ${clusterId}:`, err);
    return empty;
  }
}

/**
 * Fetch the full Wikipedia article HTML (`with_html` REST endpoint) and
 * normalize it to readable plain text for RAG ingestion. May return empty
 * string on any missing/failed step — callers treat that as "no usable RAG
 * content".
 */
async function fetchWikipediaFullText(title: string): Promise<string> {
  try {
    const encoded = encodeURIComponent(title);
    const res = await fetch(
      `https://en.wikipedia.org/w/rest.php/v1/page/${encoded}/with_html`,
      { headers: { Accept: "text/html" } },
    );
    if (!res.ok) {
      console.error(`WP: with_html fetch failed (${res.status}) for ${title}`);
      return "";
    }
    const data = await res.json();
    // The REST `with_html` endpoint returns { id, title, html, ... }.
    const html: string = data.html ?? "";
    if (!html) {
      console.error(`WP: with_html returned empty html for ${title}`);
      return "";
    }
    return htmlToText(html);
  } catch (err) {
    console.error(`WP: full-text fetch failed for ${title}:`, err);
    return "";
  }
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

  // RAG: ingest the full underlying documents of the top search results and
  // retrieve relevant chunks. This is additive and non-fatal — if RAG fails,
  // normal evidence assembly still succeeds. At most 2 sources are ingested:
  // the #1 CourtListener opinion (resolved from its cluster) and the #1
  // Wikipedia article. The normal evidence (snippet/summary) is preserved.
  try {
    const sourcesToIngest: IngestInput[] = [];

    // Top CourtListener result — resolve the cluster to its underlying
    // opinion and ingest the full opinion text (html_with_citations).
    if (searchContext?.courtlistener?.clusterId) {
      const full = await fetchCourtListenerFullText(
        searchContext.courtlistener.clusterId,
      );
      if (full.text) {
        sourcesToIngest.push({
          // Use the opinion URL (if resolved) so ingested rows map to the
          // actual opinion; fall back to the cluster search page.
          url: full.opinionUrl || searchContext.courtlistener.url,
          sourceType: "article",
          title: searchContext.courtlistener.title,
          sourceText: full.text,
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
      } else {
        console.error(
          `RAG: CourtListener full-text unavailable for cluster ${searchContext.courtlistener.clusterId}; skipping`,
        );
      }
    }

    // Top Wikipedia result — fetch the full article via the MediaWiki REST
    // `with_html` endpoint and ingest the normalized article text.
    if (searchContext?.wikipedia?.title) {
      const text = await fetchWikipediaFullText(searchContext.wikipedia.title);
      if (text) {
        sourcesToIngest.push({
          url: searchContext.wikipedia.url,
          sourceType: "article",
          title: searchContext.wikipedia.title,
          sourceText: text,
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
      } else {
        console.error(
          `RAG: Wikipedia full-text unavailable for ${searchContext.wikipedia.title}; skipping`,
        );
      }
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
      const chunks = await retrieveChunks(queryText, { topK: 3 });

      evidence.ragChunks = chunks.slice(0, 3);

      console.log(`RAG: retrieved ${chunks.length} chunks`);
      evidence.ragChunks.forEach((chunk, index) => {
        console.log(`===== RAG CHUNK ${index + 1} =====`);
        console.log(chunk);
        console.log(`===== END RAG CHUNK ${index + 1} =====`);
      });

      evidence.ragChunks = chunks;
      console.log(`RAG: retrieved ${chunks.length} chunks`);
    }
  } catch (err) {
    console.error("RAG retrieval failed:", err);
  }

  return evidence;
}
