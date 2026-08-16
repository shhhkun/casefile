"""FastAPI service — exposes POST /analyze matching the Next.js contract.

Run locally with:
    uvicorn casefile.api.server:app --reload

For hosted web services, the app binds to 0.0.0.0 and reads $PORT.
"""

import logging
import os

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from ..errors import SourceError
from ..pipeline.analyze import analyze
from ..types import CaseAnalysis

# Ensure logger output is visible even when uvicorn's default config
# doesn't include the `casefile` logger.
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

app = FastAPI(title="CaseFile Python Pipeline", version="0.1.0")


class AnalyzeRequest(BaseModel):
    url: str
    refinementNames: list[str] = []
    model: str = ""


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/analyze", response_model=CaseAnalysis)
def analyze_endpoint(req: AnalyzeRequest) -> CaseAnalysis:
    """Run the full analysis pipeline and return a CaseAnalysis JSON."""
    logger.info("Analyze request received: url=%r refinementNames=%r model=%r", req.url, req.refinementNames, req.model)
    if not req.url:
        raise HTTPException(status_code=400, detail="URL is required")

    try:
        return analyze(
            url=req.url,
            refinement_names=req.refinementNames,
            model=req.model,
        )
    except SourceError as err:
        raise HTTPException(status_code=err.status_code, detail=err.message)
    except Exception as err:
        logger.exception("Analyze: unexpected error: %s", err)
        raise HTTPException(status_code=500, detail="Analysis failed")


def main() -> None:
    """Entry point for `python -m casefile.api.server`."""
    import uvicorn

    port = int(os.environ.get("PORT", "8000"))
    uvicorn.run(app, host="0.0.0.0", port=port)


if __name__ == "__main__":
    main()