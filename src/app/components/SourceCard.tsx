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
      className="flex p-0.5 items-center border rounded cursor-pointer hover:opacity-70 bg-(--accent) border-(--border)"
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
      className="flex p-0.5 items-center border rounded cursor-pointer hover:opacity-70 bg-(--accent) border-(--border)"
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
    <div className="w-full border-t-2 border-dashed pt-4 border-(--line) first:border-t-0 first:pt-0">
      <div className="flex w-full p-4 border-2 rounded-lg bg-(--bg) border-(--border)">
        <div className="flex flex-col w-full">
          <div className="flex flex-row w-full gap-2">
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
    <div className="flex flex-94 min-w-0 flex-col">
      <div className="flex flex-row h-15.5 px-6 justify-between items-center rounded-t-2xl border-2 bg-(--bg) border-(--border)">
        <h1 className="font-bold">Sources</h1> <PanelLeft />
      </div>
      <div className="flex flex-col h-full p-6 gap-4 rounded-b-2xl border-x-2 border-b-2 bg-(--bg2) border-(--border)">
        {analysis?.candidates.map((c, i) => (
          <Source key={i} candidate={c} />
        ))}
      </div>
    </div>
  );
}
