import { YoutubeTranscript } from "youtube-transcript";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const { url } = await req.json();

    if (!url) {
      return NextResponse.json(
        { error: "YouTube URL is required" },
        { status: 400 },
      );
    }

    const transcript = await YoutubeTranscript.fetchTranscript(url);
    const fullText = transcript.map((entry) => entry.text).join(" ");

    return NextResponse.json({ transcript: fullText });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to fetch transcript" },
      { status: 500 },
    );
  }
}
