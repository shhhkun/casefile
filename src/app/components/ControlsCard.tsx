import React from "react";
import { PanelRight } from "lucide-react";

export default function ControlsCard({}) {
  return (
    <div className="flex flex-94 min-w-0 flex-col">
      <div className="flex flex-row h-15.5 px-6 justify-between items-center rounded-t-2xl border-2 bg-(--bg) border-(--border)">
        <h1 className="font-bold">Investigation Controls</h1> <PanelRight />
      </div>
      {/* Content */}
      <div className="flex flex-col h-full p-6 gap-4 rounded-b-2xl border-x-2 border-b-2 bg-(--bg2) border-(--border)">
        {/* System Instructions */}
        <h2>System Instructions (read-only)</h2>

        <hr className="border-t-2 border-(--line)" />

        <div className="flex w-full p-4 rounded-lg border-2 bg-(--bg) border-(--border)">
          <p>
            - Extract full legal names including middle names where available
            (e.g. &quot;Hadden Irving Clark&quot; not &quot;Hadden Clark&quot;)
            <br />
            - Treat extracted names as potentially noisy if source is a
            speech-to-text transcript
            <br />
            - Treat location, year, crime type, and keywords as the most
            reliable signals
            <br />- For defendant and victim, always prefer the most complete
            name available
          </p>
        </div>

        {/* Your Instructions */}
        <h2>Your Instructions (optional)</h2>

        <hr className="border-t-2 border-(--line)" />

        <div className="w-full rounded-lg border-2 border-(--border) bg(--bg2) overflow-hidden">
          <textarea
            placeholder="Add context to refine the case analysis..."
            className="block resize-none w-full min-h-40 p-4 bg-(--accent) focus:outline-none"
          />
        </div>
      </div>
    </div>
  );
}
