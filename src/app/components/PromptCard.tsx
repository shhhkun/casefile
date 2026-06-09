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
      <div className="flex flex-row h-15.5 px-6 justify-between items-center rounded-t-2xl border-b-2 bg-(--bg3) border-(--border)">
        <h1>Case File</h1> <Menu />
      </div>
      {/* Content */}
      <div className="flex flex-col h-full p-6 rounded-b-2xl bg-(--bg2)">
        {/* URL insert */}
        <div className="flex w-full p-1 rounded-lg border bg-(--card-bg) border-(--border2)">
          <div className="flex w-full flex-row p-3 gap-3 rounded-md border bg-(--card-bg2) border-(--border3)">
            <div className="flex flex-col w-full gap-3">
              <input
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="Enter a source URL..."
                className="h-6.5 p-2 rounded bg-(--bg2) shadow-[inset_0_4px_4px_rgba(0,0,0,0.25)] focus:outline-(--border2)"
              />
              <input
                type="text"
                value={namesInput}
                onChange={(e) => setNamesInput(e.target.value)}
                placeholder="Known names related to the case (optional)..."
                className="h-6.5 p-2 rounded bg-(--bg2) shadow-[inset_0_4px_4px_rgba(0,0,0,0.25)] focus:outline-(--border2)"
              />
            </div>

            <div className="flex flex-col justify-end">
              <button
                onClick={onSubmit}
                disabled={loading}
                className="flex flex-row items-center h-6.5 p-2 gap-2 text-(--text2) rounded bg-(--accent) shadow-[inset_0_0_8px_rgba(0,0,0,0.25)]"
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
    </div>
  );
}
