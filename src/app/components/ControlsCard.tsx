import React from "react";
import { PanelRight } from "lucide-react";

interface ControlsProps {
  isCollapsed: boolean;
  onToggle: () => void;
}

export default function ControlsCard({ isCollapsed, onToggle }: ControlsProps) {
  return (
    <div className="flex min-w-0 flex-94 flex-col">
      <div className="flex h-15.5 flex-row items-center justify-between rounded-t-2xl border-2 border-(--border) bg-(--bg) px-6">
        <h1 className="font-bold">Investigation Controls</h1> <PanelRight />
      </div>
      {/* Content */}
      <div className="flex h-full flex-col gap-4 rounded-b-2xl border-x-2 border-b-2 border-(--border) bg-(--bg2) p-6">
        {/* System Instructions */}
        <h2>System Instructions (read-only)</h2>

        <hr className="border-t-2 border-(--line)" />

        <div className="flex w-full rounded-lg border-2 border-(--border) bg-(--bg) p-4">
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

        <div className="bg(--bg2) w-full overflow-hidden rounded-lg border-2 border-(--border)">
          <textarea
            placeholder="Add context to refine the case analysis..."
            className="block min-h-40 w-full resize-none bg-(--accent) p-4 focus:outline-none"
          />
        </div>
      </div>
    </div>
  );
}
