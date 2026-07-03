import { ResolvedCase } from "./types";

export interface Evidence {
  originalText?: string;

  wikipedia?: {
    title: string;
    text: string;
    url: string;
  };

  courtlistener?: {
    title: string;
    text: string;
    url: string;
    court?: string;
    dateFiled?: string;
  };
}

// Fetch full source documents for the resolved case
export async function fetchEvidence(
  resolved: ResolvedCase,
  originalText: string,
): Promise<Evidence> {
  const selected = resolved.selectedCase;

  // Always include original extracted input
  const evidence: Evidence = {
    originalText,
  };

  try {
    if (selected.source === "wikipedia" && selected.url) {
      const pageTitle = selected.url.split("/wiki/")[1];

      const res = await fetch(
        `https://en.wikipedia.org/api/rest_v1/page/summary/${pageTitle}`,
      );

      if (res.ok) {
        const data = await res.json();

        evidence.wikipedia = {
          title: data.title,
          text: data.extract,
          url: data.content_urls?.desktop?.page ?? selected.url,
        };
      }
    }

    if (selected.source === "courtlistener" && selected.url) {
      // CourtListener doesn't give full text easily via search API, so we reuse snippet as "evidence layer" for now

      evidence.courtlistener = {
        title: selected.title,
        text: selected.snippet ?? "",
        url: selected.url,
        court: selected.metadata?.court,
        dateFiled: selected.metadata?.dateFiled,
      };
    }
  } catch (err) {
    console.error("Evidence fetch failed:", err);
  }

  return evidence;
}
