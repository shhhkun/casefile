import React from "react";
import { PanelLeft } from "lucide-react";

export default function SourceCard({}) {
  return (
    <div className="flex flex-94 flex-col">
      <div className="flex flex-row h-15.5 px-6 justify-between items-center rounded-t-2xl border-b-2 bg-(--bg3) border-(--border)">
        <h1>Sources</h1> <PanelLeft />
      </div>
      <div className="flex h-full p-6 rounded-b-2xl bg-(--bg2)"> content </div>
    </div>
  );
}
