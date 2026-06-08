import React from "react";
import { PanelRight } from "lucide-react";

export default function ControlsCard({}) {
  return (
    <div className="flex flex-94 flex-col">
      <div className="flex flex-row h-15.5 px-6 justify-between items-center rounded-t-2xl border-b-2 bg-(--bg3) border-(--border)">
        <h1>Investigation Controls</h1> <PanelRight />
      </div>
      {/* Content */}
      <div className="flex flex-col h-full p-6 gap-3 rounded-b-2xl bg-(--bg2)">
        {/* System Instructions */}
        <h2>System Instructions (read-only)</h2>

        <hr className="border-(--border)" />

        <div className="flex w-full p-1 text-sm rounded-lg border bg-(--card-bg) border-(--border2)">
          <div className="flex w-full p-3 rounded-md border bg-(--card-bg2) border-(--border3)">
            <p>
              - Extract full legal names including middle names where available
              (e.g. &quot;Hadden Irving Clark&quot; not &quot;Hadden
              Clark&quot;)
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
        </div>

        {/* Your Instructions */}
        <h2>Your Instructions (optional)</h2>

        <hr className="border-(--border)" />

        <div className="flex w-full p-1 text-sm rounded-lg border bg-(--card-bg) border-(--border2)">
          <div className="w-full rounded-md border border-(--border3) bg(--bg2) overflow-hidden">
            <textarea
              placeholder="Add context to refine the case analysis..."
              className="block resize-none w-full min-h-40 p-3 bg-transparent focus:outline-none shadow-[inset_0_0_32px_rgba(0,0,0,0.25)]"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
