import React from "react";
import { PanelRight } from "lucide-react";

interface ControlsProps {
  isCollapsed: boolean;
  onToggle: () => void;
}

export default function ControlsCard({ isCollapsed, onToggle }: ControlsProps) {
  return (
    <div
      className={`flex min-w-0 shrink-0 basis-1/4 flex-col transition-all duration-300 ease-in-out ${isCollapsed ? "max-w-16" : "max-w-[25%]"}`}
    >
      {/* Header */}
      <div
        className={`flex h-15.5 shrink-0 flex-row items-center rounded-t-2xl border-2 border-(--border) bg-(--bg) px-6 ${isCollapsed ? "justify-center" : "justify-between"}`}
      >
        {!isCollapsed && (
          <h1 className="min-w-0 truncate font-bold whitespace-nowrap">
            Investigation Controls
          </h1>
        )}
        <button
          onClick={onToggle}
          className="cursor-pointer rounded p-1 transition-colors duration-200 hover:bg-(--bg2)"
        >
          <PanelRight />
        </button>
      </div>
      {/* Content */}
      <div className="flex h-full flex-col gap-4 rounded-b-2xl border-x-2 border-b-2 border-(--border) bg-(--bg2) p-6">
        {!isCollapsed && (
          <>
            {/* System Instructions */}
            <h2>System Instructions (read-only)</h2>

            <hr className="border-t-2 border-(--line)" />

            <div className="flex w-full rounded-lg border-2 border-(--border) bg-(--bg) p-4">
              <p>
                - Extract full legal names including middle names where
                available (e.g. &quot;Hadden Irving Clark&quot; not &quot;Hadden
                Clark&quot;)
                <br />
                - Treat extracted names as potentially noisy if source is a
                speech-to-text transcript
                <br />
                - Treat location, year, crime type, and keywords as the most
                reliable signals
                <br />- For defendant and victim, always prefer the most
                complete name available
              </p>
            </div>

            {/* Your Instructions */}
            <h2>Your Instructions (optional)</h2>

            <hr className="border-t-2 border-(--line)" />

            <div className="bg(--bg2) w-full overflow-hidden rounded-lg border-2 border-(--border)">
              <textarea
                placeholder="Add context to refine the case analysis..."
                className="block min-h-40 w-full resize-none bg-(--accent) p-4 placeholder-(--text)/50 focus:outline-none"
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
