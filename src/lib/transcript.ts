import { YoutubeTranscript } from "youtube-transcript";

export async function extractTranscript(url: string) {
  const transcript = await YoutubeTranscript.fetchTranscript(url);

  return transcript.map((entry) => entry.text).join(" ");
}
