"use client";

import { useState } from "react";
import { CaseAnalysis } from "@/types";

import SourceCard from "./components/SourceCard";
import ControlsCard from "./components/ControlsCard";
import PromptCard from "./components/PromptCard";
import Toast from "./components/Toast";

export default function Page() {
  const [url, setUrl] = useState("");
  const [namesInput, setNamesInput] = useState("");
  const [analysis, setAnalysis] = useState<CaseAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [isLeftCollapsed, setIsLeftCollapsed] = useState(false);
  const [isRightCollapsed, setIsRightCollapsed] = useState(false);

  const [model, setModel] = useState("openai/gpt-oss-120b");

  const parseNames = (input: string): string[] => {
    return input
      .split(",")
      .map((n) => n.trim())
      .filter((n) => n.length > 0);
  };

  const handleSubmit = async () => {
    setLoading(true);
    setAnalysis(null);
    setError(null);

    const refinementNames = parseNames(namesInput);

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, refinementNames, model }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Something went wrong. Please try again.");
        return;
      }

      setAnalysis(data);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-full flex-row gap-6 px-6 pb-6">
      {error && <Toast message={error} onClose={() => setError(null)} />}
      <SourceCard
        analysis={analysis}
        isCollapsed={isLeftCollapsed}
        onToggle={() => setIsLeftCollapsed(!isLeftCollapsed)}
      />
      <PromptCard
        url={url}
        setUrl={setUrl}
        namesInput={namesInput}
        setNamesInput={setNamesInput}
        onSubmit={handleSubmit}
        loading={loading}
        analysis={analysis}
        model={model}
        setModel={setModel}
      />
      <ControlsCard
        isCollapsed={isRightCollapsed}
        onToggle={() => setIsRightCollapsed(!isRightCollapsed)}
      />
    </div>
  );
}
