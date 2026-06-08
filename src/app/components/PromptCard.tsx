import React from "react";
import { Menu } from "lucide-react";

export default function PromptCard({}) {
  return (
    <div className="flex flex-148 flex-col">
      <div className="flex flex-row h-15.5 px-6 justify-between items-center rounded-t-2xl border-b-2 bg-(--bg3) border-(--border)">
        <h1>Case File</h1> <Menu />
      </div>
      <div className="flex h-full p-6 flex-col rounded-b-2xl bg-(--bg2)">
        <div className="flex w-full p-1 rounded-lg border bg-(--card-bg) border-(--border2)">
          <div className="flex w-full flex-col p-3 gap-3 rounded-md border bg-(--card-bg2) border-(--border3)">
            <input
              type="text"
              placeholder="Enter a source URL..."
              className="h-6.5 p-2 rounded bg-(--bg2) shadow-[inset_0_4px_4px_rgba(0,0,0,0.25)] focus:outline-(--border2)"
            />
            <input
              type="text"
              placeholder="Known names related to the case (optional)..."
              className="h-6.5 p-2 rounded bg-(--bg2) shadow-[inset_0_4px_4px_rgba(0,0,0,0.25)] focus:outline-(--border2)"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
