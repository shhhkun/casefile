import React from "react";
import { PanelLeft } from "lucide-react";

function CourtListenerTag({}) {
  return (
    <div className="flex p-0.5 items-center border rounded bg-(--tag-bg) border-(--tag-border)">
      <span className="text-xs text-(--tag-border)">CourtListener</span>
    </div>
  );
}

function WikipediaTag({}) {
  return (
    <div className="flex p-0.5 items-center border rounded bg-(--tag-bg2) border-(--tag-border2)">
      <span className="text-xs text-(--tag-border2)">Wikipedia</span>
    </div>
  );
}

function Source({}) {
  return (
    <div className="flex w-full p-4 border rounded-lg bg-(--bg) border-(--border)">
      <div className="flex flex-col w-full">
        <div className="flex flex-row w-full gap-2">
          <h2 className="flex-1 truncate">
            This is a really long title that goes till it forces a truncate
          </h2>
          <CourtListenerTag />
        </div>

        <p className="pt-2 text-sm">
          A bunch of random words, lorem impsum. Here is the next sentence with
          more words.
        </p>

        {/* Relevance scores */}
        <div className="pt-3.5 text-sm">
          <span className="text-(--text3)">Relevance: </span>
          <span>0.82 </span>
          <span className="text-(--text3)">- Match: </span>
          <span>High</span>
        </div>
      </div>
    </div>
  );
}

export default function SourceCard({}) {
  return (
    <div className="flex flex-94 min-w-0 flex-col">
      <div className="flex flex-row h-15.5 px-6 justify-between items-center rounded-t-2xl border-b-2 bg-(--bg3) border-(--border)">
        <h1>Sources</h1> <PanelLeft />
      </div>
      <div className="flex flex-col h-full p-6 rounded-b-2xl bg-(--bg2)">
        <Source />
      </div>
    </div>
  );
}
