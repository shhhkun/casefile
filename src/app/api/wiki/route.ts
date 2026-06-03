import { NextRequest, NextResponse } from "next/server";

interface ExtractedCase {
  defendant: string | null;
  victim: string | null;
  state: string | null;
  approximateYear: string | null;
  crimeType: string | null;
  caseName: string | null;
  jurisdiction: string | null;
  keywords: string[];
  confidence: "high" | "medium" | "low";
}

interface WikiSearchResult {
  title: string;
  snippet: string;
}

export async function POST(req: NextRequest) {
  try {
    const { extracted }: { extracted: ExtractedCase } = await req.json();

    if (!extracted) {
      return NextResponse.json(
        { error: "Extracted case data is required" },
        { status: 400 }
      );
    }

    const queryParts: string[] = [];
    if (extracted.defendant) queryParts.push(extracted.defendant);
    if (extracted.victim) queryParts.push(extracted.victim);
    if (extracted.state) queryParts.push(extracted.state);
    if (extracted.crimeType) queryParts.push(extracted.crimeType);
    if (extracted.approximateYear) queryParts.push(extracted.approximateYear);

    const query = queryParts.join(" ");

    const searchParams = new URLSearchParams({
      action: "query",
      list: "search",
      srsearch: query,
      srlimit: "3",
      format: "json",
      origin: "*",
    });

    const searchRes = await fetch(
      `https://en.wikipedia.org/w/api.php?${searchParams}`
    );

    if (!searchRes.ok) {
      return NextResponse.json(
        { error: "Wikipedia search failed" },
        { status: searchRes.status }
      );
    }

    const searchData = await searchRes.json();
    const searchResults: WikiSearchResult[] = searchData.query?.search ?? [];

    if (searchResults.length === 0) {
      return NextResponse.json({ article: null, query });
    }

    const topTitle = encodeURIComponent(searchResults[0].title);
    const summaryRes = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${topTitle}`
    );

    if (!summaryRes.ok) {
      return NextResponse.json({ article: null, query });
    }

    const summaryData = await summaryRes.json();

    return NextResponse.json({
      article: {
        title: summaryData.title as string,
        summary: summaryData.extract as string,
        url: summaryData.content_urls?.desktop?.page as string,
        thumbnail: (summaryData.thumbnail?.source as string) ?? null,
      },
      candidates: searchResults.slice(0, 3).map((r: WikiSearchResult) => ({
        title: r.title,
        snippet: r.snippet,
      })),
      query,
    });

  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: "Wikipedia search failed" },
      { status: 500 }
    );
  }
}