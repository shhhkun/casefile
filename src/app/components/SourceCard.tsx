import React from "react";
import { PanelLeft } from "lucide-react";
import { CaseAnalysis, ScoredCandidate } from "@/lib/types";

interface TagProps {
  url?: string;
}

function CourtListenerTag({ url }: TagProps) {
  const handleClick = () => {
    if (url) {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  };

  return (
    <div
      onClick={handleClick}
      className="flex cursor-pointer items-center rounded border border-(--border) bg-(--accent) p-0.5 hover:opacity-70"
      title={url}
    >
      <span className="text-xs text-(--text2) select-none">CourtListener</span>
    </div>
  );
}

function WikipediaTag({ url }: TagProps) {
  const handleClick = () => {
    if (url) {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  };

  return (
    <div
      onClick={handleClick}
      className="flex cursor-pointer items-center rounded border border-(--border) bg-(--accent) p-0.5 hover:opacity-70"
      title={url}
    >
      <span className="text-xs text-(--text2) select-none">Wikipedia</span>
    </div>
  );
}

interface SourceProps {
  candidate: ScoredCandidate;
}

function Source({ candidate }: SourceProps) {
  return (
    <div className="w-full border-t-2 border-dashed border-(--line) pt-4 first:border-t-0 first:pt-0">
      <div className="flex w-full rounded-lg border-2 border-(--border) bg-(--bg) p-4">
        <div className="flex w-full flex-col">
          <div className="flex w-full flex-row gap-2">
            <h2 className="flex-1 truncate">{candidate.title}</h2>
            {candidate.source === "wikipedia" ? (
              <WikipediaTag url={candidate.url} />
            ) : (
              <CourtListenerTag url={candidate.url} />
            )}
          </div>

          {candidate.snippet && (
            <p
              className="pt-2 text-sm"
              dangerouslySetInnerHTML={{ __html: candidate.snippet }}
            />
          )}

          {/* Relevance scores */}
          <div className="pt-3.5 text-sm">
            <span className="text-(--text3)">Relevance: </span>
            <span>{candidate.score} </span>
            <span className="text-(--text3)">- Match: </span>
            <span>X</span>
          </div>
        </div>
      </div>
    </div>
  );
}

interface SourceCardProps {
  analysis: CaseAnalysis | null;
}

export default function SourceCard({ analysis }: SourceCardProps) {
  return (
    <div className="flex min-w-0 flex-94 flex-col">
      <div className="flex h-15.5 flex-row items-center justify-between rounded-t-2xl border-2 border-(--border) bg-(--bg) px-6">
        <h1 className="font-bold">Sources</h1> <PanelLeft />
      </div>
      <div className="flex h-full flex-col gap-4 rounded-b-2xl border-x-2 border-b-2 border-(--border) bg-(--bg2) p-6">
        {analysis?.candidates.map((c, i) => (
          <Source key={i} candidate={c} />
        ))}
      </div>
    </div>
  );
}
