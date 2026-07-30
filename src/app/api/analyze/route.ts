import { NextRequest, NextResponse } from "next/server";
import { sourceContent } from "@/lib/source";
import { extractCase } from "@/lib/extract";
import { searchCourtListener } from "@/lib/search";
import { searchWikipedia } from "@/lib/wiki";
import { resolveCase } from "@/lib/resolve";
import { CaseAnalysis } from "@/lib/types";
import { fetchEvidence } from "@/lib/evidence";
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

    // Step 4: aggregate and sort candidates
    const allCandidates = [...courtResults, ...wikiResult.candidates];
    allCandidates.sort((a, b) => b.score - a.score);

    console.log("Analyze: total candidates:", allCandidates.length);

    const resolveStart = performance.now();
    // Step 5: resolve best match
    console.log("Analyze: resolving case");
    const resolved = await resolveCase(extracted, allCandidates, model, url);
    const resolveTime = performance.now() - resolveStart;

    if (!resolved) {
      return NextResponse.json(
        { error: "Could not resolve case from search results" },
        { status: 404 },
      );
    }

    console.log("Analyze: resolved:", JSON.stringify(resolved, null, 2));

    // Step 6: fetch evidence
    const evidence = await fetchEvidence(resolved, extracted, content.text);

    // Step 7: generate case overview
    const overviewStart = performance.now();
    const overview = await generateOverview(evidence, model, url);
    const overviewTime = performance.now() - overviewStart;

    const analysis: CaseAnalysis = {
      extracted,
      originalExtracted: extracted,
      resolved,
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
    console.log(`Resolve completed in ${resolveTime.toFixed(0)} ms`);
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
