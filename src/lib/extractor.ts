import { ExtractedContent } from "./types";

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";

export function isYoutubeUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.hostname === "www.youtube.com" ||
      parsed.hostname === "youtube.com" ||
      parsed.hostname === "youtu.be" ||
      parsed.hostname === "m.youtube.com"
    );
  } catch {
    return false;
  }
}

export async function extractContent(url: string): Promise<ExtractedContent> {
  console.log("Extractor: URL:", url);

  if (isYoutubeUrl(url)) {
    console.log("Extractor: routing to /api/transcript");

    const res = await fetch(`${BASE_URL}/api/transcript`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error ?? "Transcript extraction failed");
    }

    const data = await res.json();
    return {
      sourceType: "youtube",
      title: null,
      text: data.transcript,
      url,
    };
  }

  console.log("Extractor: routing to /api/article");

  const res = await fetch(`${BASE_URL}/api/article`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });

  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error ?? "Article extraction failed");
  }

  const data = await res.json();
  return {
    sourceType: "article",
    title: data.title,
    text: data.text,
    url,
  };
}