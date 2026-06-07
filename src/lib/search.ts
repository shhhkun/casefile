import { ExtractedCase, ScoredCandidate } from "./types";
import { generateQueries } from "./queries";

interface CourtListenerResult {
  id: string;
  caseName: string;
  court: string;
  dateFiled: string;
  absolute_url: string;
  snippet: string;
  score: number;
}

const TIER_BASE_SCORES: Record<number, number> = {
  0: 1.0,  // quoted refinement names
  1: 0.95, // unquoted refinement names
  2: 0.88, // quoted defendant + state
  3: 0.82, // quoted defendant alone
  4: 0.75, // quoted victim alone
  5: 0.68, // quoted both last names
  6: 0.60, // quoted defendant last + state
  7: 0.45, // crime type + state
  8: 0.30, // keywords only
};

export async function searchCourtListener(
  extracted: ExtractedCase,
  refinementNames: string[] = []
): Promise<ScoredCandidate[]> {
  const queries = generateQueries(extracted, refinementNames);
  const candidates: ScoredCandidate[] = [];
  const seenIds = new Set<string>();

  for (let i = 0; i < queries.length; i++) {
    const query = queries[i];

    const params = new URLSearchParams({
      q: query,
      type: "o",
      order_by: "score desc",
    });

    try {
      const response = await fetch(
        `https://www.courtlistener.com/api/rest/v4/search/?${params}`,
        { headers: { Accept: "application/json" } }
      );

      if (!response.ok) continue;

      const data = await response.json();
      const results: CourtListenerResult[] = data.results ?? [];

      console.log(
        `CourtListener tier ${i}: "${query}" → ${results.length} results`
      );

      for (const r of results.slice(0, 3)) {
        if (seenIds.has(r.id)) continue;
        seenIds.add(r.id);

        const normalizedApiScore = Math.min((r.score ?? 0) / 20, 1.0);
        const tierScore = TIER_BASE_SCORES[i] ?? 0.3;
        const combinedScore = tierScore * 0.6 + normalizedApiScore * 0.4;

        candidates.push({
          title: r.caseName,
          source: "courtlistener",
          score: Math.round(combinedScore * 100) / 100,
          url: `https://www.courtlistener.com${r.absolute_url}`,
          snippet: r.snippet,
          metadata: {
            court: r.court,
            dateFiled: r.dateFiled,
          },
        });
      }

      if (candidates.length >= 3) break;

    } catch (err) {
      console.error(`CourtListener query failed: "${query}"`, err);
    }
  }

  return candidates
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}