"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";

const models = [
  {
    label: "GPT OSS 120B",
    desc: "Highest Capability",
    value: "openai/gpt-oss-120b",
  },
  {
    label: "Llama 3.3 70B",
    desc: "Balanced Performance",
    value: "llama-3.3-70b-versatile",
  },
  {
    label: "Llama 3.1 8B",
    desc: "Fast Response",
    value: "llama-3.1-8b-instant",
  },
];

export default function ModelDropdown({
  model,
  setModel,
}: {
  model: string;
  setModel: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);

  const selectedModel = models.find((m) => m.value === model) ?? models[0];

  return (
    <div className="relative">
      {/* Dropdown button */}
      <button
        onClick={() => setOpen(!open)}
        className="flex h-7 min-w-36 cursor-pointer items-center justify-between gap-2 rounded border border-(--border) bg-(--accent) px-2 text-(--text2) transition-colors duration-300 ease-in-out hover:bg-(--border) hover:text-(--text4)"
      >
        <span>{selectedModel.label}</span>
        <ChevronDown size={16} />
      </button>

      {/* Dropdown menu */}
      {open && (
        <div className="absolute left-1/2 z-10 mt-1 w-max min-w-full -translate-x-1/2 rounded border border-(--border) bg-(--bg2) p-1">
          {models.map((item) => (
            <button
              key={item.value}
              onClick={() => {
                setModel(item.value);
                setOpen(false);
              }}
              className="flex w-full cursor-pointer flex-col rounded px-2 py-1 text-left hover:bg-(--bg)"
            >
              <span>{item.label}</span>
              <span className="text-sm text-(--text3)">{item.desc}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
