"""Query generation and name refinement — ports src/lib/queries.ts.

Produces tiered CourtListener queries and a single Wikipedia free-text
query from extracted case signals. Uses Jaro-Winkler similarity (via
`rapidfuzz`, the Python equivalent of the `natural` package) to match
user-provided refinement names to extracted defendant/victim names.
"""

import logging
import re

from ..types import ExtractedCase

logger = logging.getLogger(__name__)

try:
    from rapidfuzz.distance import JaroWinkler
except ImportError:  # pragma: no cover
    JaroWinkler = None  # type: ignore[assignment,misc]

# Match the TypeScript threshold from src/lib/queries.ts.
REFINEMENT_SIMILARITY_THRESHOLD = 0.84


def _normalize_name(name: str) -> str:
    return re.sub(r"[^a-z\s]", "", name.lower()).strip()


def _jaro_winkler_similarity(a: str, b: str) -> float:
    """Return Jaro-Winkler similarity (0.0-1.0), matching `natural` behavior."""
    if JaroWinkler is None:
        # Fallback: simple equality for environments without rapidfuzz.
        return 1.0 if a == b else 0.0
    return float(JaroWinkler.similarity(a, b))


def apply_refinements(
    extracted: ExtractedCase,
    refinement_names: list[str],
) -> tuple[str | None, str | None, list[str]]:
    """Match refinement names to extracted defendant/victim.

    Returns (defendant, victim, remaining_names). Mirrors
    `applyRefinements` in src/lib/queries.ts.
    """
    defendant = extracted.defendant
    victim = extracted.victim

    remaining_names: list[str] = []

    # No extracted names available, trust user refinement order.
    if not defendant and not victim:
        return (
            refinement_names[0] if refinement_names else None,
            refinement_names[1] if len(refinement_names) > 1 else None,
            refinement_names[2:],
        )

    for refinement in refinement_names:
        normalized_refinement = _normalize_name(refinement)

        matched = False

        if defendant:
            similarity = _jaro_winkler_similarity(
                _normalize_name(defendant), normalized_refinement
            )
            logger.info(
                'Defendant similarity: "%s" vs "%s" = %.4f',
                defendant,
                refinement,
                similarity,
            )
            if similarity >= REFINEMENT_SIMILARITY_THRESHOLD:
                defendant = refinement
                matched = True

        if not matched and victim:
            similarity = _jaro_winkler_similarity(
                _normalize_name(victim), normalized_refinement
            )
            logger.info(
                'Victim similarity: "%s" vs "%s" = %.4f',
                victim,
                refinement,
                similarity,
            )
            if similarity >= REFINEMENT_SIMILARITY_THRESHOLD:
                victim = refinement
                matched = True

        if not matched:
            remaining_names.append(refinement)

    return defendant, victim, remaining_names


def _apply_extracted_with_refinements(
    extracted: ExtractedCase,
    refinement_names: list[str],
) -> list[str]:
    """Mutate extracted defendant/victim with refinements; return remaining names."""
    defendant, victim, remaining_names = apply_refinements(
        extracted, refinement_names
    )
    extracted.defendant = defendant
    extracted.victim = victim
    return remaining_names


def generate_queries(
    extracted: ExtractedCase,
    refinement_names: list[str] | None = None,
) -> list[str]:
    """Generate the ordered tiered query list (mirrors src/lib/queries.ts)."""
    refinement_names = refinement_names or []
    queries: list[str] = []

    remaining_names = _apply_extracted_with_refinements(
        extracted, refinement_names
    )

    defendant = extracted.defendant
    victim = extracted.victim

    # Tier 0: quoted refinement names (exact, highest confidence)
    if remaining_names:
        queries.append(" AND ".join(f'"{n}"' for n in remaining_names))

    # Tier 1: unquoted refinement names (looser match)
    if remaining_names:
        queries.append(" AND ".join(remaining_names))

    # Tier 2: quoted defendant + state
    if defendant and extracted.state:
        queries.append(f'"{defendant}" AND {extracted.state}')

    # Tier 3: quoted defendant alone
    if defendant:
        queries.append(f'"{defendant}"')

    # Tier 4: quoted victim alone
    if victim:
        queries.append(f'"{victim}"')

    # Tier 5: quoted both last names
    if defendant and victim:
        defendant_last = defendant.split(" ")[-1]
        victim_last = victim.split(" ")[-1]
        if defendant_last and victim_last:
            queries.append(f'"{defendant_last}" AND "{victim_last}"')

    # Tier 6: quoted defendant last name + state
    if defendant and extracted.state:
        defendant_last = defendant.split(" ")[-1]
        if defendant_last:
            queries.append(f'"{defendant_last}" AND {extracted.state}')

    # Tier 7: crime type + state (name-independent)
    if extracted.crimeType and extracted.state:
        queries.append(f"{extracted.crimeType} AND {extracted.state}")

    # Tier 8: keywords only (broadest fallback)
    if extracted.keywords:
        queries.append(" AND ".join(extracted.keywords[:3]))

    return queries


def generate_wiki_query(
    extracted: ExtractedCase,
    refinement_names: list[str] | None = None,
) -> str:
    """Generate a single free-text Wikipedia search query."""
    refinement_names = refinement_names or []
    parts: list[str] = []

    remaining_names = _apply_extracted_with_refinements(
        extracted, refinement_names
    )

    defendant = extracted.defendant
    victim = extracted.victim

    if defendant:
        parts.append(defendant)
    if victim:
        parts.append(victim)

    parts.extend(remaining_names)

    if extracted.state:
        parts.append(extracted.state)
    if extracted.approximateYear:
        parts.append(extracted.approximateYear)
    if extracted.crimeType:
        parts.append(extracted.crimeType)

    return " ".join(parts)