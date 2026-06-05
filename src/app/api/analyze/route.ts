import { NextRequest, NextResponse } from "next/server";
import { extractCase } from "@/lib/extract";
import { searchCourtListener } from "@/lib/search";
import { searchWikipedia } from "@/lib/wiki";
import { resolveCase } from "@/lib/resolve";
import { CaseAnalysis } from "@/lib/types";

export async function POST(req: NextRequest) {
  try {
    const {
      url,
      refinementNames = [],
    }: { url: string; refinementNames: string[] } = await req.json();

    if (!url) {
      return NextResponse.json(
        { error: "YouTube URL is required" },
        { status: 400 }
      );
    }

    console.log("Analyze: refinement names:", refinementNames);

    // Step 1: fetch transcript
    console.log("Analyze: fetching transcript");
    const transcriptRes = await fetch(
      `${process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000"}/api/transcript`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      }
    );

    if (!transcriptRes.ok) {
      return NextResponse.json(
        { error: "Failed to fetch transcript" },
        { status: 500 }
      );
    }

    const { transcript } = await transcriptRes.json();
    console.log("Analyze: transcript length:", transcript.length);

    // Step 2: extract case signals
    console.log("Analyze: extracting case signals");
    const extracted = await extractCase(transcript);
    console.log("Analyze: extracted:", JSON.stringify(extracted, null, 2));

    // Step 3: parallel search using extracted signals + refinement names
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
        { status: 404 }
      );
    }

    console.log("Analyze: resolved:", JSON.stringify(resolved, null, 2));

    const analysis: CaseAnalysis = {
      extracted,
      originalExtracted: extracted,
      resolved,
      candidates: allCandidates,
      wikiSummary: wikiResult.summary,
      wikiUrl: wikiResult.url,
      wikiThumbnail: wikiResult.thumbnail,
      refinementNames,
    };

    return NextResponse.json(analysis);

  } catch (error) {
    console.error("Analyze: unexpected error:", error);
    return NextResponse.json(
      { error: "Analysis failed" },
      { status: 500 }
    );
  }
}