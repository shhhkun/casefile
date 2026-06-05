import { ExtractedCase } from "./types";

export function generateQueries(
  extracted: ExtractedCase,
  refinementNames: string[] = []
): string[] {
  const queries: string[] = [];

  const year = extracted.approximateYear
    ? parseInt(extracted.approximateYear)
    : null;

  const dateRange = year
    ? ` AND dateFiled:[${year - 1}-01-01 TO ${year + 8}-12-31]`
    : "";

  // Tier 0: refinement names (highest confidence, user provided)
  if (refinementNames.length > 0) {
    // All names together
    queries.push(
      `${refinementNames.join(" AND ")}${dateRange}`
    );

    // Each name individually with date range as fallback
    for (const name of refinementNames) {
      queries.push(`${name}${dateRange}`);
    }
  }

  // Tier 1: both extracted names fuzzy + date
  if (extracted.defendant && extracted.victim) {
    queries.push(
      `${extracted.defendant}~1 AND ${extracted.victim}~1${dateRange}`
    );
  }

  // Tier 2: defendant + state + date
  if (extracted.defendant && extracted.state) {
    queries.push(
      `${extracted.defendant}~1 AND ${extracted.state}${dateRange}`
    );
  }

  // Tier 3: victim + state + date
  if (extracted.victim && extracted.state) {
    queries.push(
      `${extracted.victim}~1 AND ${extracted.state}${dateRange}`
    );
  }

  // Tier 4: crime type + state + date (name-independent)
  if (extracted.crimeType && extracted.state) {
    queries.push(
      `${extracted.crimeType} AND ${extracted.state}${dateRange}`
    );
  }

  // Tier 5: keywords + date
  if (extracted.keywords?.length > 0) {
    queries.push(
      `${extracted.keywords.slice(0, 3).join(" AND ")}${dateRange}`
    );
  }

  // Tier 6: defendant alone fuzzy
  if (extracted.defendant) {
    queries.push(`${extracted.defendant}~1${dateRange}`);
  }

  return queries;
}

export function generateWikiQuery(
  extracted: ExtractedCase,
  refinementNames: string[] = []
): string {
  const parts: string[] = [];

  // Use refinement names first if available
  if (refinementNames.length > 0) {
    parts.push(...refinementNames);
  } else {
    if (extracted.defendant) parts.push(extracted.defendant);
    if (extracted.victim) parts.push(extracted.victim);
  }

  // Always include reliable signals
  if (extracted.state) parts.push(extracted.state);
  if (extracted.approximateYear) parts.push(extracted.approximateYear);
  if (extracted.crimeType) parts.push(extracted.crimeType);

  return parts.join(" ");
}