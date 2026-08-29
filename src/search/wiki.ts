import { ExtractedCase, ScoredCandidate, CachedWikiResult } from "../lib/types";
import { generateWikiQuery } from "./queries";
import { hashKey } from "../lib/hash";
import { redis } from "../lib/redis";
import { CACHE_TTL } from "../lib/cache";

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

function calculateWikiScore(
  result: WikiSearchResult,
  rank: number,
  keywords: string[],
  refinementNames: string[],
): number {
  // Scores: result1 = 1, result2 = 0.7, result3 = 0.4
  const rankScore = rank === 0 ? 1.0 : rank === 1 ? 0.7 : 0.4;

  const titleLower = result.title.toLowerCase();
  const snippetLower = result.snippet.toLowerCase();

  const keywordMatched = keywords.filter(
    (k) =>
      titleLower.includes(k.toLowerCase()) ||
      snippetLower.includes(k.toLowerCase()),
  ).length;
  const keywordScore = Math.min(
    keywordMatched / Math.max(keywords.length, 1),
    1,
  );

  const nameMatched = refinementNames.filter(
    (n) =>
      titleLower.includes(n.toLowerCase()) ||
      snippetLower.includes(n.toLowerCase()),
  ).length;
  const nameScore = Math.min(
    nameMatched / Math.max(refinementNames.length, 1),
    1,
  );

  const score = rankScore * 0.6 + keywordScore * 0.2 + nameScore * 0.2;

  return Math.round(score * 100) / 100;
}

export async function searchWikipedia(
  extracted: ExtractedCase,
  refinementNames: string[] = [],
): Promise<CachedWikiResult> {
  const query = generateWikiQuery(extracted, refinementNames);
  console.log("Wikipedia query:", query);

  const key = `wikipedia${hashKey(query)}`;
  const cached = await redis.get<CachedWikiResult>(key);
  if (cached) {
    console.log("Search (Wikipedia) HIT");
    return cached;
  }

  const searchParams = new URLSearchParams({
    action: "query",
    list: "search",
    srsearch: query,
    srlimit: "3",
    format: "json",
    origin: "*",
  });

  const searchRes = await fetch(
    `https://en.wikipedia.org/w/api.php?${searchParams}`,
  );

  if (!searchRes.ok) {
    console.error("Wikipedia search failed:", searchRes.status);
    return { candidates: [], summary: null, url: null, thumbnail: null };
  }

  const searchData = await searchRes.json();
  const searchResults: WikiSearchResult[] = searchData.query?.search ?? [];

  console.log(
    "Wikipedia results:",
    searchResults.map((r) => r.title),
  );

  if (searchResults.length === 0) {
    return { candidates: [], summary: null, url: null, thumbnail: null };
  }

  // Score all candidates
  const candidates: ScoredCandidate[] = searchResults.map((r, i) => ({
    title: r.title,
    source: "wikipedia" as const,
    score: calculateWikiScore(r, i, extracted.keywords ?? [], refinementNames),
    snippet: r.snippet,
    url: `https://en.wikipedia.org/wiki/${encodeURIComponent(r.title)}`,
  }));

  // Fetch summary for top result only
  try {
    const topTitle = encodeURIComponent(searchResults[0].title);
    const summaryRes = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${topTitle}`,
    );

    if (!summaryRes.ok) {
      return { candidates, summary: null, url: null, thumbnail: null };
    }

    const summaryData: WikiSummary = await summaryRes.json();

    const result = {
      candidates,
      summary: summaryData.extract ?? null,
      url: summaryData.content_urls?.desktop?.page ?? null,
      thumbnail: summaryData.thumbnail?.source ?? null,
    };

    await redis.set(key, result, { ex: CACHE_TTL.search });
    console.log("Search (Wikipedia) cache MISS");

    return result;
  } catch (err) {
    console.error("Wikipedia summary fetch failed:", err);
    return { candidates, summary: null, url: null, thumbnail: null };
  }
}
