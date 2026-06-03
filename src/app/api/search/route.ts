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

interface CourtListenerResult {
  id: string;
  caseName: string;
  court: string;
  dateFiled: string;
  absolute_url: string;
  snippet: string;
}

export async function POST(req: NextRequest) {
  try {
    const { extracted }: { extracted: ExtractedCase } = await req.json();

    if (!extracted) {
      return NextResponse.json(
        { error: "Extracted case data is required" },
        { status: 400 },
      );
    }

    const year = extracted.approximateYear
      ? parseInt(extracted.approximateYear)
      : null;

    const dateRange = year
      ? ` AND dateFiled:[${year - 1}-01-01 TO ${year + 8}-12-31]`
      : "";

    const queries: string[] = [];

    if (extracted.defendant && extracted.victim) {
      queries.push(
        `${extracted.defendant}~1 AND ${extracted.victim}~1${dateRange}`,
      );
    }

    if (extracted.defendant && extracted.state) {
      queries.push(
        `${extracted.defendant}~1 AND ${extracted.state}${dateRange}`,
      );
    }

    if (extracted.victim && extracted.state) {
      queries.push(`${extracted.victim}~1 AND ${extracted.state}${dateRange}`);
    }

    if (extracted.defendant) {
      queries.push(`${extracted.defendant}~1${dateRange}`);
    }

    if (extracted.keywords?.length > 0) {
      queries.push(
        `${extracted.keywords.slice(0, 3).join(" AND ")}${dateRange}`,
      );
    }

    for (const query of queries) {
      const params = new URLSearchParams({
        q: query,
        type: "o",
        order_by: "score desc",
      });

      const response = await fetch(
        `https://www.courtlistener.com/api/rest/v4/search/?${params}`,
        { headers: { Accept: "application/json" } },
      );

      const data = await response.json();
      console.log(`Query: ${query} → ${data.results?.length ?? 0} results`);

      if (data.results?.length > 0) {
        return NextResponse.json({
          results: data.results.slice(0, 3).map((r: CourtListenerResult) => ({
            id: r.id,
            caseName: r.caseName,
            court: r.court,
            dateFiled: r.dateFiled,
            url: r.absolute_url,
            snippet: r.snippet,
          })),
          query,
        });
      }
    }

    return NextResponse.json({ results: [], query: queries[0] ?? "" });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Search failed" }, { status: 500 });
  }
}
