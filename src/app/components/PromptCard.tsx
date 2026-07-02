import React from "react";
import { Menu, Link2 } from "lucide-react";

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
      <div className="flex flex-row h-15.5 px-6 justify-between items-center rounded-t-2xl border-2 bg-(--bg3) border-(--border)">
        <h1>Case File</h1> <Menu />
      </div>
      {/* Content */}
      <div className="flex flex-col h-full p-6 rounded-b-2xl border-x-2 border-b-2 bg-(--bg2) border-(--border)">
        {/* URL insert */}
          <div className="flex w-full flex-row p-3 gap-3 rounded-md border-2 bg-(--card-bg2) border-(--border)">
            <div className="flex flex-col w-full gap-3">
              <input
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="Enter a source URL..."
                className="h-6.5 p-2 rounded border bg-(--bg2) border-(--border) focus:outline-(--border2)"
              />
              <input
                type="text"
                value={namesInput}
                onChange={(e) => setNamesInput(e.target.value)}
                placeholder="Known names related to the case (optional)..."
                className="h-6.5 p-2 rounded border bg-(--bg2) border-(--border) focus:outline-(--border2)"
              />
            </div>

            <div className="flex flex-col justify-end">
              <button
                onClick={onSubmit}
                disabled={loading}
                className="flex flex-row items-center h-6.5 p-2 gap-2 text-(--text) rounded border bg-(--accent) border-(--border)"
              >
                <Link2 size={20} />
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
