"""Metadata extraction — ports src/lib/extract.ts.

Calls the Groq LLM to extract structured case signals (ExtractedCase) from
source text. Uses the same prompt, truncation (first 12,000 chars), model
default, temperature, and Redis cache semantics as the TypeScript reference.
"""

import json
import logging
import os

from ..cache import CACHE_TTL, cache
from ..types import ExtractedCase

logger = logging.getLogger(__name__)

try:
    from groq import Groq
except ImportError:  # pragma: no cover
    Groq = None  # type: ignore[assignment,misc]

DEFAULT_MODEL = "openai/gpt-oss-120b"

EXTRACT_PROMPT = """Analyze this text and extract structured information about the primary criminal case being described.

                  IMPORTANT INSTRUCTIONS:
                  - Extract full legal names including middle names where available (e.g. "Hadden Irving Clark" not "Hadden Clark")
                  - Treat extracted names as potentially noisy if source is a speech-to-text transcript
                  - Treat location, year, crime type, and keywords as the most reliable signals
                  - For defendant and victim, always prefer the most complete name available

                  Use this exact structure:
                  {{
                    "caseName": "string or null",
                    "defendant": "string or null",
                    "victim": "string or null",
                    "crimeType": "string or null",
                    "jurisdiction": "string or null",
                    "state": "string or null",
                    "approximateYear": "string or null",
                    "keywords": ["string"],
                    "confidence": "high | medium | low"
                  }}

                  Text:
                  {text}"""

SYSTEM_PROMPT = (
    "You are a legal case identifier. Return ONLY valid JSON with no markdown, "
    "no code blocks, no explanation."
)


def _get_groq():
    if Groq is None:
        raise RuntimeError("groq is not installed. Run: pip install -r requirements.txt")
    api_key = os.environ.get("GROQ_API_KEY")
    if not api_key:
        raise RuntimeError("Missing GROQ_API_KEY environment variable")
    return Groq(api_key=api_key)


def extract_case(
    transcript: str,
    model: str = DEFAULT_MODEL,
    url: str = "",
) -> ExtractedCase:
    """Extract structured case metadata from source text (truncated to 12,000 chars)."""
    key = f"extract:{url}"
    cached = cache.get(key)
    if cached is not None:
        logger.info("Extract cache HIT")
        return ExtractedCase(**cached)

    prompt = EXTRACT_PROMPT.format(text=transcript[:12000])

    client = _get_groq()
    completion = client.chat.completions.create(
        model=model or DEFAULT_MODEL,
        temperature=0.1,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": prompt},
        ],
    )

    text = (completion.choices[0].message.content or "").strip()
    logger.info("Extract: raw response: %s", text)

    try:
        parsed = json.loads(text)
        result = ExtractedCase(**parsed)
        logger.info("Extract: parsed: %s", json.dumps(result.model_dump(), indent=2))
        cache.set(key, result.model_dump(), CACHE_TTL.extract)
        logger.info("Extract cache MISS")
        return result
    except (json.JSONDecodeError, TypeError) as err:
        raise RuntimeError(f"Failed to parse extraction response: {text}") from err