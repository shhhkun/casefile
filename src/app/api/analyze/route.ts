import { NextRequest, NextResponse } from "next/server";
import { SourceError } from "@/lib/errors";
import { sourceContent } from "@/lib/source";
import { extractCase } from "@/lib/extract";
import { searchCourtListener } from "@/lib/search";
import { searchWikipedia } from "@/lib/wiki";
import { CaseAnalysis } from "@/lib/types";
import { fetchEvidence, SearchContext } from "@/lib/evidence";
import { generateOverview } from "@/lib/overview";

export async function POST(req: NextRequest) {
  try {
    const analyzeStart = performance.now();

    const {
      url,
      refinementNames = [],
      model,
    }: {
      url: string;
      refinementNames: string[];
      model: string;
    } = await req.json();

    if (!url) {
      return NextResponse.json({ error: "URL is required" }, { status: 400 });
    }

    console.log("Analyze: refinement names:", refinementNames);

    const sourceStart = performance.now();
    // Step 1: source content from URL (YouTube or article)
    console.log("Analyze: extracting content from URL");
    let content;
    try {
      content = await sourceContent(url);
    } catch (err) {
      console.error("Analyze: content extraction failed:", err);
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
    const sourceTime = performance.now() - sourceStart;

    console.log("Analyze: source type:", content.sourceType);
    console.log("Analyze: content length:", content.text.length);

    const extractStart = performance.now();
    // Step 2: extract case signals
    const extracted = await extractCase(content.text, model, url);
    const extractTime = performance.now() - extractStart;

    console.log("Analyze: extracted:", JSON.stringify(extracted, null, 2));

    const searchStart = performance.now();
    // Step 3: parallel search
    console.log("Analyze: running parallel search");
    const [courtResults, wikiResult] = await Promise.all([
      searchCourtListener(extracted, refinementNames),
      searchWikipedia(extracted, refinementNames),
    ]);
    const searchTime = performance.now() - searchStart;

    console.log("Analyze: court candidates:", courtResults.length);
    console.log("Analyze: wiki candidates:", wikiResult.candidates.length);

    // Aggregate and sort candidates for the UI and RAG ingestion.
    const allCandidates = [...courtResults, ...wikiResult.candidates];
    allCandidates.sort((a, b) => b.score - a.score);

    console.log("Analyze: total candidates:", allCandidates.length);

    // Preserve the #1 CourtListener and #1 Wikipedia search results as
    // pipeline metadata for Evidence Assembly (RAG). CourtListener results
    // are RAG ingestion candidates (legal source corpus for retrieval);
    // Wikipedia results provide concise narrative/case context.
    const searchContext: SearchContext = {};

    if (courtResults.length > 0) {
      const topCourt = courtResults[0];
      searchContext.courtlistener = {
        title: topCourt.title,
        url: topCourt.url ?? "",
        snippet: topCourt.snippet ?? "",
        court: topCourt.metadata?.court,
        dateFiled: topCourt.metadata?.dateFiled,
        clusterId: topCourt.metadata?.cluster_id,
      };
    }

    if (wikiResult.candidates.length > 0 && wikiResult.summary) {
      searchContext.wikipedia = {
        title: wikiResult.candidates[0].title,
        url: wikiResult.url ?? wikiResult.candidates[0].url ?? "",
        summary: wikiResult.summary,
      };
    }

    // Step 5: fetch evidence (includes RAG ingestion + retrieval)
    const evidence = await fetchEvidence(
      extracted,
      content.text,
      searchContext,
    );

    // Step 6: generate case overview
    const overviewStart = performance.now();
    const overview = await generateOverview(evidence, model, url);
    const overviewTime = performance.now() - overviewStart;

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

    const analyzeEnd = performance.now();

    console.log(`Source completed in ${sourceTime.toFixed(0)} ms`);
    console.log(`Extract completed in ${extractTime.toFixed(0)} ms`);
    console.log(`Search completed in ${searchTime.toFixed(0)} ms`);
    console.log(`Overview completed in ${overviewTime.toFixed(0)} ms`);
    console.log(
      `Analyze (API) completed in ${(analyzeEnd - analyzeStart).toFixed(0)} ms`,
    );

    return NextResponse.json(analysis);
  } catch (error) {
    console.error("Analyze: unexpected error:", error);
    return NextResponse.json({ error: "Analysis failed" }, { status: 500 });
  }
}
