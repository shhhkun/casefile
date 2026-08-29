import {
  YoutubeTranscript,
  YoutubeTranscriptDisabledError,
  YoutubeTranscriptError,
  YoutubeTranscriptNotAvailableError,
  YoutubeTranscriptNotAvailableLanguageError,
  YoutubeTranscriptTooManyRequestError,
  YoutubeTranscriptVideoUnavailableError,
} from "youtube-transcript";
import { SourceError } from "../errors";

export async function extractTranscript(url: string) {
  let transcript;
  try {
    transcript = await YoutubeTranscript.fetchTranscript(url);
  } catch (err) {
    if (err instanceof YoutubeTranscriptDisabledError) {
      throw new SourceError("Transcript is disabled for this video.", 400);
    }
    if (err instanceof YoutubeTranscriptNotAvailableError) {
      throw new SourceError("No transcript is available for this video.", 400);
    }
    if (err instanceof YoutubeTranscriptVideoUnavailableError) {
      throw new SourceError("This video is no longer available.", 400);
    }
    if (err instanceof YoutubeTranscriptTooManyRequestError) {
      throw new SourceError(
        "YouTube is rate limiting requests. Please try again later.",
        429,
      );
    }
    if (err instanceof YoutubeTranscriptNotAvailableLanguageError) {
      throw new SourceError(
        "Transcript is not available in the requested language.",
        400,
      );
    }
    if (err instanceof YoutubeTranscriptError) {
      throw new SourceError("Invalid YouTube URL.", 400);
    }
    throw err;
  }

  return transcript.map((entry) => entry.text).join(" ");
}
