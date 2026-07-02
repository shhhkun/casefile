import { NextRequest, NextResponse } from "next/server";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";

export async function POST(req: NextRequest) {
  try {
    const { url } = await req.json();

    if (!url) {
      return NextResponse.json({ error: "URL is required" }, { status: 400 });
    }

    console.log("Article: fetching URL:", url);

    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });

    if (!response.ok) {
      return NextResponse.json(
        {
          error: `Failed to fetch URL: ${response.status} ${response.statusText}`,
        },
        { status: response.status },
      );
    }

    const html = await response.text();
    console.log("Article: HTML length:", html.length);

    const dom = new JSDOM(html, { url });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();

    if (!article) {
      return NextResponse.json(
        { error: "Could not extract article content from this URL" },
        { status: 422 },
      );
    }

    console.log("Article: extracted title:", article.title);
    console.log("Article: text length:", article.textContent?.length ?? 0);

    return NextResponse.json({
      title: article.title,
      text: article.textContent,
    });
  } catch (error) {
    console.error("Article: unexpected error:", error);
    return NextResponse.json(
      { error: "Article extraction failed" },
      { status: 500 },
    );
  }
}
