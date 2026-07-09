import { ResolvedCase, ExtractedCase } from "./types";

export interface Evidence {
  caseInfo?: {
    caseName: string | null;
    defendant: string | null;
    victim: string | null;
    crimeType: string | null;
    jurisdiction: string | null;
    state: string | null;
    approximateYear: string | null;
  };

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

// Limit long text/transcript extractions to first 60% and last 40% of maxChars
function limitText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;

  const head = Math.floor(maxChars * 0.6);
  const tail = Math.floor(maxChars * 0.4);

  return text.slice(0, head) + "\n\n[Middle omitted]\n\n" + text.slice(-tail);
}

// Fetch full source documents for the resolved case
export async function fetchEvidence(
  resolved: ResolvedCase,
  extracted: ExtractedCase,
  originalText: string,
): Promise<Evidence> {
  const selected = resolved.selectedCase;

  // Always include original extracted input
  const evidence: Evidence = {
    caseInfo: {
      caseName: extracted.caseName,
      defendant: extracted.defendant,
      victim: extracted.victim,
      crimeType: extracted.crimeType,
      jurisdiction: extracted.jurisdiction,
      state: extracted.state,
      approximateYear: extracted.approximateYear,
    },
    originalText: limitText(originalText, 14000),
  };

  console.log("Evidence caseInfo:", JSON.stringify(evidence.caseInfo, null, 2));

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
          text: limitText(data.extract, 6000),
          url: data.content_urls?.desktop?.page ?? selected.url,
        };
      }
    }

    if (selected.source === "courtlistener" && selected.url) {
      // CourtListener doesn't give full text easily via search API, so we reuse snippet as "evidence layer" for now

      evidence.courtlistener = {
        title: selected.title,
        text: selected.snippet ?? "", // 4000 limit once arg type fixed
        url: selected.url,
        court: selected.metadata?.court,
        dateFiled: selected.metadata?.dateFiled,
      };
    }

    console.log("Evidence sizes:");
    console.log(
      "Original text:",
      evidence.originalText?.length ?? 0,
      "chars",
      "≈",
      Math.ceil((evidence.originalText?.length ?? 0) / 4),
      "tokens",
    );
    console.log(
      "Wikipedia:",
      evidence.wikipedia?.text.length ?? 0,
      "chars",
      "≈",
      Math.ceil((evidence.wikipedia?.text.length ?? 0) / 4),
      "tokens",
    );
    console.log(
      "CourtListener:",
      evidence.courtlistener?.text.length ?? 0,
      "chars",
      "≈",
      Math.ceil((evidence.courtlistener?.text.length ?? 0) / 4),
      "tokens",
    );
    console.log(
      "Total evidence chars:",
      JSON.stringify(evidence).length,
      "≈",
      Math.ceil(JSON.stringify(evidence).length / 4),
      "tokens",
    );
  } catch (err) {
    console.error("Evidence fetch failed:", err);
  }

  return evidence;
}
