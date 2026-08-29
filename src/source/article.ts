import * as cheerio from "cheerio";
import { SourceError } from "../errors/errors";

export async function extractArticle(url: string) {
  console.log("Article: fetching URL:", url);

  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
  } catch (err) {
    if (err instanceof TypeError) {
      throw new SourceError("Invalid URL.", 400);
    }
    throw err;
  }

  if (!response.ok) {
    throw new SourceError(
      `Failed to fetch URL: ${response.status} ${response.statusText}`,
      400,
    );
  }

  const html = await response.text();

  console.log("Article: HTML length:", html.length);

  const $ = cheerio.load(html);

  // Remove obvious noise
  $("script, style, nav, footer, header").remove();

  const title = $("title").text() || null;

  const text = $("body").text().replace(/\s+/g, " ").trim();

  console.log("Article: extracted title:", title);
  console.log("Article: text length:", text.length);

  return {
    title,
    text,
  };
}
