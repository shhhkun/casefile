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
    const {
      url,
      refinementNames = [],
    }: { url: string; refinementNames: string[] } = await req.json();

    if (!url) {
      return NextResponse.json({ error: "URL is required" }, { status: 400 });
    }

    console.log("Analyze: refinement names:", refinementNames);

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

    console.log("Analyze: source type:", content.sourceType);
    console.log("Analyze: content length:", content.text.length);

    // Step 2: extract case signals
    console.log("Analyze: extracting case signals");
    const extracted = await extractCase(content.text);
    console.log("Analyze: extracted:", JSON.stringify(extracted, null, 2));

    // Step 3: parallel search
    console.log("Analyze: running parallel search");
    const [courtResults, wikiResult] = await Promise.all([
      searchCourtListener(extracted, refinementNames),
      searchWikipedia(extracted, refinementNames),
    ]);

    console.log("Analyze: court candidates:", courtResults.length);
    console.log("Analyze: wiki candidates:", wikiResult.candidates.length);

    // Step 4: aggregate and sort candidates
    const allCandidates = [...courtResults, ...wikiResult.candidates];
    allCandidates.sort((a, b) => b.score - a.score);

    console.log("Analyze: total candidates:", allCandidates.length);

    // Step 5: resolve best match
    console.log("Analyze: resolving case");
    const resolved = await resolveCase(extracted, allCandidates);

    if (!resolved) {
      return NextResponse.json(
        { error: "Could not resolve case from search results" },
        { status: 404 },
      );
    }

    console.log("Analyze: resolved:", JSON.stringify(resolved, null, 2));

    // Step 6: fetch evidence
    const evidence = await fetchEvidence(resolved, content.text);

    // Step 7: generate case overview
    const overview = await generateOverview(evidence);

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

    return NextResponse.json(analysis);
  } catch (error) {
    console.error("Analyze: unexpected error:", error);
    return NextResponse.json({ error: "Analysis failed" }, { status: 500 });
  }
}
