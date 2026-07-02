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
    <div className="flex min-w-0 flex-148 flex-col">
      {/* Header */}
      <div className="flex h-15.5 flex-row items-center justify-between rounded-t-2xl border-2 border-(--border) bg-(--) px-6">
        <h1 className="font-bold">Case File</h1> <Menu />
      </div>
      {/* Content */}
      <div className="flex h-full flex-col rounded-b-2xl border-x-2 border-b-2 border-(--border) bg-(--bg2) p-6">
        {/* URL insert */}
        <div className="flex w-full flex-row gap-4 rounded-lg border-2 border-(--border) bg-(--bg) p-4">
          <div className="flex w-full flex-col gap-3">
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="Enter a source URL..."
              className="h-7 rounded border border-(--border) bg-(--bg2) p-2 focus:ring focus:ring-(--border) focus:outline-none"
            />
            <input
              type="text"
              value={namesInput}
              onChange={(e) => setNamesInput(e.target.value)}
              placeholder="Known names related to the case (optional)..."
              className="h-7 rounded border border-(--border) bg-(--bg2) p-2 focus:ring focus:ring-(--border) focus:outline-none"
            />
          </div>

          <div className="flex flex-col justify-end">
            <button
              onClick={onSubmit}
              disabled={loading}
              className="flex h-7 cursor-pointer flex-row items-center gap-2 rounded border border-(--border) bg-(--accent) p-2 text-(--text2) transition-colors duration-300 ease-in-out hover:bg-(--border) hover:text-(--text4)"
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
