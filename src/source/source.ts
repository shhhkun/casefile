import { ExtractedContent } from "../lib/types";
import { extractArticle } from "./article";
import { extractTranscript } from "./transcript";
import { redis } from "../lib/redis";
import { CACHE_TTL } from "../lib/cache";

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

export async function sourceContent(url: string): Promise<ExtractedContent> {
  console.log("Source extracted: URL:", url);

  const key = `source:${url}`;
  const cached = await redis.get<ExtractedContent>(key);
  let result: ExtractedContent;
  if (cached) {
    console.log("Source cache HIT");
    return cached;
  }

  if (isYoutubeUrl(url)) {
    console.log("Source extracted: routing to transcript extractor");

    const transcript = await extractTranscript(url);

    console.log("Source extracted: transcript length:", transcript.length);

    result = {
      sourceType: "youtube",
      title: null,
      text: transcript,
      url,
    };

    await redis.set(key, result, { ex: CACHE_TTL.source });
    console.log("Source cache MISS");
    return result;
  }

  console.log("Source extracted: routing to article extractor");

  const article = await extractArticle(url);

  console.log("Source extracted: article title:", article.title);
  console.log("Source extracted: article text length:", article.text.length);

  result = {
    sourceType: "article",
    title: article.title ?? null,
    text: article.text,
    url,
  };

  await redis.set(key, result, { ex: CACHE_TTL.source });
  console.log("Source cache MISS");

  return result;
}
