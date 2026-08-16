"""YouTube transcript extraction — ports src/lib/transcript.ts.

Uses the `youtube-transcript-api` package (Python equivalent of the
TypeScript `youtube-transcript` package). Maps YouTube errors into
SourceError exceptions matching the TypeScript error semantics.
"""

import logging

from ..errors import SourceError

logger = logging.getLogger(__name__)

try:
    from youtube_transcript_api import (
        NoTranscriptFound,
        TranscriptsDisabled,
        VideoUnavailable,
        TooManyRequests,
        NoTranscriptAvailable,
        YouTubeTranscriptApi,
    )
except ImportError:  # pragma: no cover - only hit before dependencies are installed
    YouTubeTranscriptApi = None  # type: ignore[assignment]
    NoTranscriptFound = Exception  # type: ignore[assignment,misc]
    TranscriptsDisabled = Exception  # type: ignore[assignment,misc]
    VideoUnavailable = Exception  # type: ignore[assignment,misc]
    TooManyRequests = Exception  # type: ignore[assignment,misc]
    NoTranscriptAvailable = Exception  # type: ignore[assignment,misc]


def extract_transcript(url: str) -> str:
    """Fetch and join the YouTube transcript for a video URL into a single string."""
    if YouTubeTranscriptApi is None:
        raise SourceError(
            "youtube-transcript-api is not installed. Run: pip install -r requirements.txt",
            500,
        )

    try:
        # Extract video ID from the URL.
        from urllib.parse import parse_qs, urlparse

        parsed = urlparse(url)
        if parsed.hostname == "youtu.be":
            video_id = parsed.path.lstrip("/")
        else:
            video_id = parse_qs(parsed.query).get("v", [None])[0]

        if not video_id:
            raise SourceError("Invalid YouTube URL.", 400)

        transcript_list = YouTubeTranscriptApi.list_transcripts(video_id)
        transcript = transcript_list.find_transcript([])
        snippets = transcript.fetch()
        text = " ".join(snippet.text for snippet in snippets)
        return text
    except (VideoUnavailable,):
        raise SourceError("This video is no longer available.", 400)
    except (TranscriptsDisabled,):
        raise SourceError("Transcript is disabled for this video.", 400)
    except (NoTranscriptFound, NoTranscriptAvailable):
        raise SourceError("No transcript is available for this video.", 400)
    except (TooManyRequests,):
        raise SourceError(
            "YouTube is rate limiting requests. Please try again later.",
            429,
        )
    except SourceError:
        raise
    except Exception as err:
        logger.exception("YouTube transcript extraction failed: %s", err)
        raise SourceError("Invalid YouTube URL.", 400)