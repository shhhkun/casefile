import { NextRequest, NextResponse } from "next/server";

import type { CaseAnalysis } from "@/lib/types";
import type { SearchContext } from "@/evidence/evidence";

const PYTHON_SERVICE_URL = process.env.PYTHON_SERVICE_URL;

/**
 * POST /api/analyze
 *
 * Thin proxy to the Python FastAPI pipeline service.
 * - When PYTHON_SERVICE_URL is set, forwards to Python (`POST /analyze`).
 * - Falls back to the local TypeScript pipeline (reference implementation).
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { url, refinementNames = [], model } = body;

    console.log("Analyze: received request body:", JSON.stringify(body));

    if (!url) {
      return NextResponse.json({ error: "URL is required" }, { status: 400 });
    }

    if (PYTHON_SERVICE_URL) {
      try {
        console.log(
          "Analyze: running python pipeline, forwarding:",
          JSON.stringify({ url, refinementNames, model }),
        );
        const response = await fetch(`${PYTHON_SERVICE_URL}/analyze`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url, refinementNames, model }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => null);
          return NextResponse.json(
            {
              error: errorData?.detail ?? errorData?.error ?? "Analysis failed",
            },
            { status: response.status },
          );
        }

        return NextResponse.json(await response.json());
      } catch (error) {
        console.error("Analyze: Python proxy request failed:", error);
        console.log("Analyze: falling back to local TypeScript pipeline");
        return runLocalPipeline(url, refinementNames, model);
      }
    }

    // When PYTHON_SERVICE_URL is not set, run the local TypeScript pipeline.
    console.log("Analyze: running local pipeline");
    return runLocalPipeline(url, refinementNames, model);
  } catch (error) {
    console.error("Analyze: unexpected error:", error);
    return NextResponse.json({ error: "Analysis failed" }, { status: 500 });
  }
}

/** Run the local TypeScript analysis pipeline (reference implementation). */
async function runLocalPipeline(
  url: string,
  refinementNames: string[],
  model: string,
) {
  const { SourceError } = await import("@/lib/errors");
  const { sourceContent } = await import("@/lib/source");
  const { extractCase } = await import("@/extract/extract");
  const { searchCourtListener } = await import("@/lib/search");
  const { searchWikipedia } = await import("@/lib/wiki");
  const { fetchEvidence } = await import("@/evidence/evidence");
  const { generateOverview } = await import("@/overview/overview");

  // Step 1: source content from URL (YouTube or article)
  let content;
  try {
    content = await sourceContent(url);
  } catch (err) {
    if (err instanceof SourceError) {
      return NextResponse.json(
        { error: err.message },
        { status: err.statusCode },
      );
    }
    return NextResponse.json(
      { error: "Failed to extract content from URL" },
      { status: 500 },
    );
  }

  // Step 2: extract case signals
  const extracted = await extractCase(content.text, model, url);

  // Step 3: parallel search
  const [courtResults, wikiResult] = await Promise.all([
    searchCourtListener(extracted, refinementNames),
    searchWikipedia(extracted, refinementNames),
  ]);

  const allCandidates = [...courtResults, ...wikiResult.candidates].sort(
    (a, b) => b.score - a.score,
  );

  // Preserve #1 search results as SearchContext for RAG.
  const searchContext: SearchContext = {};
  if (courtResults.length > 0) {
    const top = courtResults[0];
    searchContext.courtlistener = {
      title: top.title,
      url: top.url ?? "",
      snippet: top.snippet ?? "",
      court: top.metadata?.court,
      dateFiled: top.metadata?.dateFiled,
      clusterId: top.metadata?.cluster_id,
    };
  }
  if (wikiResult.candidates.length > 0 && wikiResult.summary) {
    searchContext.wikipedia = {
      title: wikiResult.candidates[0].title,
      url: wikiResult.url ?? wikiResult.candidates[0].url ?? "",
      summary: wikiResult.summary,
    };
  }

  // Step 5: evidence assembly (includes RAG)
  const evidence = await fetchEvidence(extracted, content.text, searchContext);

  // Step 6: overview generation
  const overview = await generateOverview(evidence, model, url);

  const analysis: CaseAnalysis = {
    extracted,
    originalExtracted: extracted,
    candidates: allCandidates,
    wikiSummary: wikiResult.summary,
    wikiUrl: wikiResult.url,
    wikiThumbnail: wikiResult.thumbnail,
    refinementNames,
    sourceType: content.sourceType,
    sourceTitle: content.title,
    overview,
  };

  return NextResponse.json(analysis);
}
