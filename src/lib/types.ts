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

export interface ResolvedCase {
  selectedCase: ScoredCandidate;
  confidence: number;
  reasoning: string;
}

export interface CaseAnalysis {
  extracted: ExtractedCase;
  originalExtracted: ExtractedCase;
  resolved: ResolvedCase;
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
