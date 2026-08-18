"""Overview generation — ports src/lib/overview.ts.

Calls the Groq LLM with the full Evidence object serialized into the prompt
to generate a structured case overview (summary, timeline, people, legal
outcome, FAQ). Uses the same prompt, model default, temperature, and Redis
cache semantics as the TypeScript reference.
"""

import json
import logging
import os
import re

from ..cache import CACHE_TTL, cache
from ..evidence.evidence import Evidence
from ..types import CaseOverview

logger = logging.getLogger(__name__)

try:
    from groq import Groq
except ImportError:  # pragma: no cover
    Groq = None  # type: ignore[assignment,misc]

DEFAULT_MODEL = "openai/gpt-oss-120b"

OVERVIEW_PROMPT = """You are a legal case summarizer.

                  Using ONLY the evidence below, create a structured case overview.

                  If information is missing, write "Unknown".

                  IMPORTANT INSTRUCTIONS:
                  - caseInfo contains structured case metadata and corrected entity names.
                  - Prefer caseInfo values over names found in originalText.
                  - originalText may contain transcription errors.

                  EVIDENCE:
                  {evidence}

                  Return ONLY valid JSON in this format:

                  {{
                  "summary": "...",
                  "timeline": ["..."],
                  "people": [
                      {{ "name": "...", "role": "..." }}
                  ],
                  "legalOutcome": "...",
                  "faq": [
                      {{ "question": "...", "answer": "..." }}
                  ]
                  }}
                  """

SYSTEM_PROMPT = "Return only valid JSON."


def _get_groq():
    if Groq is None:
        raise RuntimeError("groq is not installed. Run: pip install -r requirements.txt")
    api_key = os.environ.get("GROQ_API_KEY")
    if not api_key:
        raise RuntimeError("Missing GROQ_API_KEY environment variable")
    return Groq(api_key=api_key)


def generate_overview(
    evidence: Evidence,
    model: str = DEFAULT_MODEL,
    url: str = "",
) -> CaseOverview:
    """Generate a structured case overview from evidence."""
    key = f"overview:{url}"
    cached = cache.get(key)
    if cached is not None:
        logger.info("Overview cache HIT")
        return CaseOverview(**cached)

    evidence_json = json.dumps(evidence.to_dict(), indent=2)
    prompt = OVERVIEW_PROMPT.format(evidence=evidence_json)

    client = _get_groq()
    completion = client.chat.completions.create(
        model=model or DEFAULT_MODEL,
        temperature=0.2,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": prompt},
        ],
    )

    text = (completion.choices[0].message.content or "").strip()

    # Remove any markdown json wrapping.
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)

    parsed = json.loads(text)
    result = CaseOverview(**parsed)

    cache.set(key, result.model_dump(), CACHE_TTL.overview)
    logger.info("Overview cache MISS")

    return result