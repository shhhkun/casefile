"""CaseFile Python pipeline package."""

from pathlib import Path

# Load environment variables from the repo-root `.env.local` (Next.js) and
# `python/.env` (Python) so secrets like GROQ_API_KEY, UPSTASH_REDIS_*, and
# DATABASE_URL are available to the pipeline regardless of how the process is
# started (uvicorn, tests, or a direct script).
try:
    from dotenv import load_dotenv

    _ROOT = Path(__file__).resolve().parents[2]  # repo root (cwd/casefile)
    _ENV_LOCAL = _ROOT / ".env.local"
    _ENV_PYTHON = Path(__file__).resolve().parent / ".env"

    if _ENV_LOCAL.exists():
        load_dotenv(_ENV_LOCAL, override=False)
    if _ENV_PYTHON.exists():
        load_dotenv(_ENV_PYTHON, override=False)
except ImportError:  # python-dotenv not installed yet
    pass

__version__ = "0.1.0"