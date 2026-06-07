import { ExtractedCase } from "./types";

export function generateQueries(
  extracted: ExtractedCase,
  refinementNames: string[] = []
): string[] {
  const queries: string[] = [];

  // Tier 0: quoted refinement names (exact, highest confidence)
  if (refinementNames.length > 0) {
    queries.push(
      refinementNames.map((n) => `"${n}"`).join(" AND ")
    );
  }

  // Tier 1: unquoted refinement names (looser match)
  if (refinementNames.length > 0) {
    queries.push(refinementNames.join(" AND "));
  }

  // Tier 2: quoted defendant + state
  if (extracted.defendant && extracted.state) {
    queries.push(`"${extracted.defendant}" AND ${extracted.state}`);
  }

  // Tier 3: quoted defendant alone
  if (extracted.defendant) {
    queries.push(`"${extracted.defendant}"`);
  }

  // Tier 4: quoted victim alone
  if (extracted.victim) {
    queries.push(`"${extracted.victim}"`);
  }

  // Tier 5: quoted both last names
  if (extracted.defendant && extracted.victim) {
    const defendantLast = extracted.defendant.split(" ").pop();
    const victimLast = extracted.victim.split(" ").pop();
    if (defendantLast && victimLast) {
      queries.push(`"${defendantLast}" AND "${victimLast}"`);
    }
  }

  // Tier 6: quoted defendant last name + state
  if (extracted.defendant && extracted.state) {
    const defendantLast = extracted.defendant.split(" ").pop();
    if (defendantLast) {
      queries.push(`"${defendantLast}" AND ${extracted.state}`);
    }
  }

  // Tier 7: crime type + state (name-independent)
  if (extracted.crimeType && extracted.state) {
    queries.push(`${extracted.crimeType} AND ${extracted.state}`);
  }

  // Tier 8: keywords only (broadest fallback)
  if (extracted.keywords?.length > 0) {
    queries.push(extracted.keywords.slice(0, 3).join(" AND "));
  }

  return queries;
}

export function generateWikiQuery(
  extracted: ExtractedCase,
  refinementNames: string[] = []
): string {
  const parts: string[] = [];

  if (refinementNames.length > 0) {
    parts.push(...refinementNames);
  } else {
    if (extracted.defendant) parts.push(extracted.defendant);
    if (extracted.victim) parts.push(extracted.victim);
  }

  if (extracted.state) parts.push(extracted.state);
  if (extracted.approximateYear) parts.push(extracted.approximateYear);
  if (extracted.crimeType) parts.push(extracted.crimeType);

  return parts.join(" ");
}