export interface ExtractedCase {
  caseName: string | null;
  defendant: string | null;
  victim: string | null;
  crimeType: string | null;
  jurisdiction: string | null;
  state: string | null;
  approximateYear: string | null;
  keywords: string[];
  confidence: "high" | "medium" | "low";
}

export interface ScoredCandidate {
  title: string;
  source: "courtlistener" | "wikipedia";
  score: number;
  url?: string;
  snippet?: string;
  metadata?: Record<string, string>;
}

export interface CaseAnalysis {
  extracted: ExtractedCase;
  originalExtracted: ExtractedCase;
  candidates: ScoredCandidate[];
  wikiSummary: string | null;
  wikiUrl: string | null;
  wikiThumbnail: string | null;
  refinementNames: string[];
  sourceType: "youtube" | "article";
  sourceTitle: string | null;
  overview: CaseOverview;
}

export interface ExtractedContent {
  sourceType: "youtube" | "article";
  title: string | null;
  text: string;
  url: string;
}

export interface CaseOverview {
  summary: string;
  timeline: string[];
  people: {
    name: string;
    role: string;
  }[];
  legalOutcome: string;
  faq: {
    question: string;
    answer: string;
  }[];
}

// Redis cache-specific

export interface CachedCourtListenerResult {
  id: string;
  cluster_id: string;
  caseName: string;
  court: string;
  dateFiled: string;
  absolute_url: string;
  snippet: string;
  score: number;
}

export interface CachedWikiResult {
  candidates: ScoredCandidate[];
  summary: string | null;
  url: string | null;
  thumbnail: string | null;
}
