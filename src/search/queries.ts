import { ExtractedCase } from "../lib/types";
import natural from "natural";

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z\s]/g, "")
    .trim();
}

function applyRefinements(extracted: ExtractedCase, refinementNames: string[]) {
  let defendant = extracted.defendant;
  let victim = extracted.victim;

  const remainingNames: string[] = [];

  // No extracted names available, trust user refinement order
  if (!defendant && !victim) {
    return {
      defendant: refinementNames[0] ?? null,
      victim: refinementNames[1] ?? null,
      remainingNames: refinementNames.slice(2),
    };
  }

  for (const refinement of refinementNames) {
    const normalizedRefinement = normalizeName(refinement);

    let matched = false;

    if (defendant) {
      const similarity = natural.JaroWinklerDistance(
        normalizeName(defendant),
        normalizedRefinement,
      );

      console.log(
        `Defendant similarity: "${defendant}" vs "${refinement}" = ${similarity}`,
      );

      if (similarity >= 0.84) {
        defendant = refinement;
        matched = true;
      }
    }

    if (!matched && victim) {
      const similarity = natural.JaroWinklerDistance(
        normalizeName(victim),
        normalizedRefinement,
      );

      console.log(
        `Victim similarity: "${victim}" vs "${refinement}" = ${similarity}`,
      );

      if (similarity >= 0.84) {
        victim = refinement;
        matched = true;
      }
    }

    if (!matched) {
      remainingNames.push(refinement);
    }
  }

  return {
    defendant,
    victim,
    remainingNames,
  };
}

function applyExtractedWithRefinements(
  extracted: ExtractedCase,
  refinementNames: string[],
): string[] {
  const { defendant, victim, remainingNames } = applyRefinements(
    extracted,
    refinementNames,
  );

  extracted.defendant = defendant;
  extracted.victim = victim;

  return remainingNames;
}

export function generateQueries(
  extracted: ExtractedCase,
  refinementNames: string[] = [],
): string[] {
  const queries: string[] = [];

  const remainingNames = applyExtractedWithRefinements(
    extracted,
    refinementNames,
  );

  const { defendant, victim } = extracted;

  // Tier 0: quoted refinement names (exact, highest confidence)
  if (remainingNames.length > 0) {
    queries.push(remainingNames.map((n) => `"${n}"`).join(" AND "));
  }

  // Tier 1: unquoted refinement names (looser match)
  if (remainingNames.length > 0) {
    queries.push(remainingNames.join(" AND "));
  }

  // Tier 2: quoted defendant + state
  if (defendant && extracted.state) {
    queries.push(`"${defendant}" AND ${extracted.state}`);
  }

  // Tier 3: quoted defendant alone
  if (defendant) {
    queries.push(`"${defendant}"`);
  }

  // Tier 4: quoted victim alone
  if (victim) {
    queries.push(`"${victim}"`);
  }

  // Tier 5: quoted both last names
  if (defendant && victim) {
    const defendantLast = defendant.split(" ").pop();
    const victimLast = victim.split(" ").pop();
    if (defendantLast && victimLast) {
      queries.push(`"${defendantLast}" AND "${victimLast}"`);
    }
  }

  // Tier 6: quoted defendant last name + state
  if (defendant && extracted.state) {
    const defendantLast = defendant.split(" ").pop();
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
  refinementNames: string[] = [],
): string {
  const parts: string[] = [];

  const remainingNames = applyExtractedWithRefinements(
    extracted,
    refinementNames,
  );

  const { defendant, victim } = extracted;

  if (defendant) parts.push(defendant);
  if (victim) parts.push(victim);

  parts.push(...remainingNames);

  if (extracted.state) parts.push(extracted.state);
  if (extracted.approximateYear) parts.push(extracted.approximateYear);
  if (extracted.crimeType) parts.push(extracted.crimeType);

  return parts.join(" ");
}
