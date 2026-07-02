import React from "react";
import { Menu, Play } from "lucide-react";

interface PromptCardProps {
  url: string;
  setUrl: (url: string) => void;
  namesInput: string;
  setNamesInput: (namesInput: string) => void;
  onSubmit: () => void;
  loading: boolean;
}

export default function PromptCard({
  url,
  setUrl,
  namesInput,
  setNamesInput,
  onSubmit,
  loading,
}: PromptCardProps) {
  return (
    <div className="flex flex-148 min-w-0 flex-col">
      {/* Header */}
      <div className="flex flex-row h-15.5 px-6 justify-between items-center rounded-t-2xl border-2 bg-(--) border-(--border)">
        <h1 className="font-bold">Case File</h1> <Menu />
      </div>
      {/* Content */}
      <div className="flex flex-col h-full p-6 rounded-b-2xl border-x-2 border-b-2 bg-(--bg2) border-(--border)">
        {/* URL insert */}
        <div className="flex w-full flex-row p-4 gap-4 rounded-lg border-2 bg-(--bg) border-(--border)">
          <div className="flex flex-col w-full gap-3">
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="Enter a source URL..."
              className="h-7 p-2 rounded border bg-(--bg2) border-(--border) focus:outline-(--border)"
            />
            <input
              type="text"
              value={namesInput}
              onChange={(e) => setNamesInput(e.target.value)}
              placeholder="Known names related to the case (optional)..."
              className="h-7 p-2 rounded border bg-(--bg2) border-(--border) focus:outline-(--border)"
            />
          </div>

          <div className="flex flex-col justify-end">
            <button
              onClick={onSubmit}
              disabled={loading}
              className="flex flex-row items-center h-7 p-2 gap-2 text-(--text) rounded border cursor-pointer hover:opacity-70 bg-(--accent) border-(--border)"
            >
              <Play size={16} />
              <span className="whitespace-nowrap">
                {loading ? "Processing..." : "Extract URL"}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
