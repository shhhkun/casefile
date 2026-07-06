import React from "react";
import { Menu, Play } from "lucide-react";
import { CaseAnalysis, CaseOverview } from "@/lib/types";

function CaseOverviewPanel({ overview }: { overview: CaseOverview }) {
  return (
    <div className="flex flex-col gap-4">
      <section>
        <h2 className="font-semibold">Summary</h2>
        <p className="text-sm">{overview.summary}</p>
      </section>

      <section>
        <h2 className="font-semibold">Timeline</h2>
        <ul className="list-disc pl-5 text-sm">
          {overview.timeline.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="font-semibold">People</h2>
        <div className="text-sm">
          {overview.people.map((p, i) => (
            <div key={i}>
              <span className="font-medium">{p.name}</span> — {p.role}
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="font-semibold">Legal Outcome</h2>
        <p className="text-sm">{overview.legalOutcome}</p>
      </section>

      <section>
        <h2 className="font-semibold">FAQs</h2>
        <div className="space-y-2 text-sm">
          {overview.faq.map((f, i) => (
            <div key={i}>
              <p className="font-medium">Q: {f.question}</p>
              <p>A: {f.answer}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

interface PromptCardProps {
  url: string;
  setUrl: (url: string) => void;
  namesInput: string;
  setNamesInput: (namesInput: string) => void;
  onSubmit: () => void;
  loading: boolean;
  analysis: CaseAnalysis | null;
}

export default function PromptCard({
  url,
  setUrl,
  namesInput,
  setNamesInput,
  onSubmit,
  loading,
  analysis,
}: PromptCardProps) {
  return (
    <div className="flex min-w-0 grow flex-col transition-all duration-300 ease-in-out">
      {/* Header */}
      <div className="flex h-15.5 shrink-0 flex-row items-center justify-between rounded-t-2xl border-2 border-(--border) bg-(--) px-6">
        <h1 className="font-bold">Case File</h1> <Menu />
      </div>
      {/* Content */}
      <div className="flex h-full flex-col overflow-hidden rounded-b-2xl border-x-2 border-b-2 border-(--border) bg-(--bg2)">
        <div className="p-6">
          <div className="mx-auto flex w-full max-w-4xl flex-row gap-4 rounded-lg border-2 border-(--border) bg-(--bg) p-4">
            {/* URL insert */}
            <section className="flex w-full flex-col gap-3">
              <input
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="Enter a source URL..."
                className="h-7 rounded border border-(--border) bg-(--bg2) p-2 placeholder-(--text)/50 focus:ring focus:ring-(--border) focus:outline-none"
              />
              <input
                type="text"
                value={namesInput}
                onChange={(e) => setNamesInput(e.target.value)}
                placeholder="Known names related to the case (optional)..."
                className="h-7 rounded border border-(--border) bg-(--bg2) p-2 placeholder-(--text)/50 focus:ring focus:ring-(--border) focus:outline-none"
              />
            </section>

            {/* Extract button */}
            <section className="flex flex-col justify-end">
              <button
                onClick={onSubmit}
                disabled={loading}
                className="flex h-7 cursor-pointer flex-row items-center gap-2 rounded border border-(--border) bg-(--accent) p-2 text-(--text2) transition-colors duration-300 ease-in-out hover:bg-(--border) hover:text-(--text4)"
              >
                <Play size={16} />
                <span className="whitespace-nowrap">
                  {loading ? "Processing..." : "Extract URL"}
                </span>
              </button>
            </section>
          </div>
        </div>

        {/* Case overview */}
        <section className="overflow-y-scroll px-6 pb-6">
          <div className="mx-auto max-w-4xl">
            {analysis?.overview && (
              <CaseOverviewPanel overview={analysis.overview} />
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
