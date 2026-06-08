import React from "react";
import { PanelRight } from "lucide-react";

export default function ControlsCard({}) {
  return (
    <div className="flex flex-94 flex-col">
      <div className="flex flex-row h-15.5 px-6 justify-between items-center rounded-t-2xl border-b-2 bg-(--bg3) border-(--border)">
        <h1>Investigation Controls</h1> <PanelRight />
      </div>
      <div className="flex h-full p-6 rounded-b-2xl bg-(--bg2)"> content </div>
    </div>
  );
}
