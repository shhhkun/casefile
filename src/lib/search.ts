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
  0: 1.0,  // refinement names all together
  1: 0.95, // refinement names individual
  2: 0.85, // both extracted names fuzzy
  3: 0.75, // defendant + state
  4: 0.70, // victim + state
  5: 0.55, // crime type + state
  6: 0.45, // keywords
  7: 0.30, // defendant alone
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

      if (results.length > 0) break;

    } catch (err) {
      console.error(`CourtListener query failed: "${query}"`, err);
    }
  }

  return candidates.sort((a, b) => b.score - a.score);
}