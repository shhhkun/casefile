import { ExtractedContent } from "./types";
import { extractArticle } from "./article";
import { extractTranscript } from "./transcript";

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

  if (isYoutubeUrl(url)) {
    console.log("Source extracted: routing to transcript extractor");

    const transcript = await extractTranscript(url);

    console.log("Source extracted: transcript length:", transcript.length);

    return {
      sourceType: "youtube",
      title: null,
      text: transcript,
      url,
    };
  }

  console.log("Source extracted: routing to article extractor");

  const article = await extractArticle(url);

  console.log("Source extracted: article title:", article.title);
  console.log("Source extracted: article text length:", article.text.length);

  return {
    sourceType: "article",
    title: article.title ?? null,
    text: article.text,
    url,
  };
}
