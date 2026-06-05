import { ExtractedCase, ScoredCandidate } from "./types";
import { generateWikiQuery } from "./queries";

interface WikiSearchResult {
  title: string;
  snippet: string;
}

interface WikiSummary {
  title: string;
  extract: string;
  content_urls?: { desktop?: { page?: string } };
  thumbnail?: { source?: string };
}

export interface WikiResult {
  candidates: ScoredCandidate[];
  summary: string | null;
  url: string | null;
  thumbnail: string | null;
}

function calculateWikiScore(
  result: WikiSearchResult,
  rank: number,
  keywords: string[],
  refinementNames: string[]
): number {
  const rankScore = rank === 0 ? 0.7 : rank === 1 ? 0.5 : 0.3;

  const titleLower = result.title.toLowerCase();
  const snippetLower = result.snippet.toLowerCase();

  // Check keyword overlap
  const keywordMatched = keywords.filter(
    (k) =>
      titleLower.includes(k.toLowerCase()) ||
      snippetLower.includes(k.toLowerCase())
  ).length;
  const keywordBonus =
    Math.min(keywordMatched / Math.max(keywords.length, 1), 1) * 0.2;

  // Check refinement name overlap — higher bonus
  const nameMatched = refinementNames.filter(
    (n) =>
      titleLower.includes(n.toLowerCase()) ||
      snippetLower.includes(n.toLowerCase())
  ).length;
  const nameBonus =
    Math.min(nameMatched / Math.max(refinementNames.length, 1), 1) * 0.3;

  return (
    Math.round(Math.min(rankScore + keywordBonus + nameBonus, 1.0) * 100) / 100
  );
}

export async function searchWikipedia(
  extracted: ExtractedCase,
  refinementNames: string[] = []
): Promise<WikiResult> {
  const query = generateWikiQuery(extracted, refinementNames);
  console.log("Wikipedia query:", query);

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
    console.error("Wikipedia search failed:", searchRes.status);
    return { candidates: [], summary: null, url: null, thumbnail: null };
  }

  const searchData = await searchRes.json();
  const searchResults: WikiSearchResult[] = searchData.query?.search ?? [];

  console.log(
    "Wikipedia results:",
    searchResults.map((r) => r.title)
  );

  if (searchResults.length === 0) {
    return { candidates: [], summary: null, url: null, thumbnail: null };
  }

  const candidates: ScoredCandidate[] = searchResults.map((r, i) => ({
    title: r.title,
    source: "wikipedia" as const,
    score: calculateWikiScore(
      r,
      i,
      extracted.keywords ?? [],
      refinementNames
    ),
    snippet: r.snippet,
  }));

  try {
    const topTitle = encodeURIComponent(searchResults[0].title);
    const summaryRes = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${topTitle}`
    );

    if (!summaryRes.ok) {
      return { candidates, summary: null, url: null, thumbnail: null };
    }

    const summaryData: WikiSummary = await summaryRes.json();

    return {
      candidates,
      summary: summaryData.extract ?? null,
      url: summaryData.content_urls?.desktop?.page ?? null,
      thumbnail: summaryData.thumbnail?.source ?? null,
    };
  } catch (err) {
    console.error("Wikipedia summary fetch failed:", err);
    return { candidates, summary: null, url: null, thumbnail: null };
  }
}