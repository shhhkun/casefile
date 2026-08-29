import * as cheerio from "cheerio";

import type { FetchedSource } from "./types";

function htmlToText(html: string): string {
  const $ = cheerio.load(html);

  // Remove obvious noise / metadata blocks.
  $("script, style, nav, footer, header, aside, form").remove();

  return $("body").text().replace(/\s+/g, " ").trim();
}

/**
 * Fetch the full CourtListener opinion associated with a cluster.
 *
 * CourtListener case-law URLs use a cluster ID. The Cluster API exposes
 * the underlying opinion URL(s) through `sub_opinions`.
 *
 * The opinion's `html_with_citations` field is preferred because
 * CourtListener identifies it as the primary text used by its website.
 */
export async function fetchCourtListenerSource(
  clusterId: string,
): Promise<FetchedSource | null> {
  const token = process.env.COURTLISTENER_API_TOKEN;

  if (!token) {
    console.error("COURTLISTENER_API_TOKEN is not configured");
    return null;
  }

  try {
    // 1. Resolve the cluster to its underlying opinion URL.
    const clusterRes = await fetch(
      `https://www.courtlistener.com/api/rest/v4/clusters/${clusterId}/`,
      {
        headers: {
          Accept: "application/json",
          Authorization: `Token ${token}`,
        },
      },
    );

    if (!clusterRes.ok) {
      console.error(
        `CL: cluster fetch failed (${clusterRes.status}) for ${clusterId}`,
      );
      return null;
    }

    const cluster = await clusterRes.json();

    const firstOpinionUrl = cluster.sub_opinions?.[0] as string | undefined;

    if (!firstOpinionUrl) {
      console.error(`CL: no sub_opinions found for cluster ${clusterId}`);
      return null;
    }

    // 2. Fetch the actual opinion record.
    const opinionRes = await fetch(firstOpinionUrl, {
      headers: {
        Accept: "application/json",
        Authorization: `Token ${token}`,
      },
    });

    if (!opinionRes.ok) {
      console.error(
        `CL: opinion fetch failed (${opinionRes.status}) for ${firstOpinionUrl}`,
      );
      return null;
    }

    const opinion = await opinionRes.json();

    // CourtListener recommends html_with_citations for opinion text.
    const html = opinion.html_with_citations ?? opinion.html ?? "";

    if (!html) {
      console.error(`CL: opinion ${firstOpinionUrl} has no usable HTML text`);
      return null;
    }

    const sourceText = htmlToText(html);

    if (!sourceText) {
      console.error(
        `CL: opinion ${firstOpinionUrl} produced empty normalized text`,
      );
      return null;
    }

    const url = opinion.absolute_url
      ? `https://www.courtlistener.com${opinion.absolute_url}`
      : firstOpinionUrl;

    return {
      url,
      sourceType: "article",
      title:
        cluster.case_name || cluster.case_name_full || "CourtListener Opinion",
      sourceText,
    };
  } catch (err) {
    console.error(`CL: full-text fetch failed for cluster ${clusterId}:`, err);
    return null;
  }
}

/**
 * Fetch and normalize a full Wikipedia article.
 *
 * Uses Wikipedia's `with_html` endpoint and converts the returned HTML
 * into readable plain text for RAG ingestion.
 */
export async function fetchWikipediaSource(
  title: string,
  url: string,
): Promise<FetchedSource | null> {
  try {
    const encodedTitle = encodeURIComponent(title);

    const res = await fetch(
      `https://en.wikipedia.org/w/rest.php/v1/page/${encodedTitle}/with_html`,
      {
        headers: {
          Accept: "text/html",
        },
      },
    );

    if (!res.ok) {
      console.error(`WP: with_html fetch failed (${res.status}) for ${title}`);
      return null;
    }

    const data = await res.json();
    const html: string = data.html ?? "";

    if (!html) {
      console.error(`WP: empty HTML returned for ${title}`);
      return null;
    }

    const sourceText = htmlToText(html);

    if (!sourceText) {
      console.error(`WP: ${title} produced empty normalized text`);
      return null;
    }

    return {
      url,
      sourceType: "article",
      title: data.title ?? title,
      sourceText,
    };
  } catch (err) {
    console.error(`WP: full-text fetch failed for ${title}:`, err);
    return null;
  }
}
