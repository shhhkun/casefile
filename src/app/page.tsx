"use client";

import { useState } from "react";
import { CaseAnalysis } from "@/lib/types";

import SourceCard from "./components/SourceCard";
import ControlsCard from "./components/ControlsCard";
import PromptCard from "./components/PromptCard";

export default function Page() {
  const [url, setUrl] = useState("");
  const [namesInput, setNamesInput] = useState("");
  const [analysis, setAnalysis] = useState<CaseAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const parseNames = (input: string): string[] => {
    return input
      .split(",")
      .map((n) => n.trim())
      .filter((n) => n.length > 0);
  };

  const handleSubmit = async () => {
    setLoading(true);
    setError("");
    setAnalysis(null);

    const refinementNames = parseNames(namesInput);

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, refinementNames }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Something went wrong");
        return;
      }

      setAnalysis(data);
    } catch {
      setError("Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-row h-full px-6 pb-6 gap-6">
      <SourceCard></SourceCard>
      <PromptCard
        url={url}
        setUrl={setUrl}
        namesInput={namesInput}
        setNamesInput={setNamesInput}
        onSubmit={handleSubmit}
        loading={loading}
      />
      <ControlsCard></ControlsCard>
    </div>
  );

  // return (
  //   <main className="p-8">
  //     <input
  //       type="text"
  //       value={url}
  //       onChange={(e) => setUrl(e.target.value)}
  //       placeholder="Paste a YouTube URL, news article, or Wikipedia link"
  //       className="border p-2 w-full mb-3"
  //     />
  //     <input
  //       type="text"
  //       value={namesInput}
  //       onChange={(e) => setNamesInput(e.target.value)}
  //       placeholder="Names (optional) — e.g. Hadden Clark, Laura Houghteling"
  //       className="border p-2 w-full mb-4 text-sm"
  //     />
  //     <button
  //       onClick={handleSubmit}
  //       disabled={loading}
  //       className="bg-black text-white px-4 py-2"
  //     >
  //       {loading ? "Processing..." : "Analyze"}
  //     </button>

  //     {error && <p className="text-red-500 mt-4">{error}</p>}

  //     {analysis && (
  //       <div className="mt-6 space-y-6">

  //         {/* Source info */}
  //         <div>
  //           <h2 className="font-bold text-lg mb-2">Source</h2>
  //           <p className="text-sm text-gray-500">
  //             Type: {analysis.sourceType}
  //             {analysis.sourceTitle && ` — ${analysis.sourceTitle}`}
  //           </p>
  //         </div>

  //         {/* Extracted signals */}
  //         <div>
  //           <h2 className="font-bold text-lg mb-2">Extracted Signals</h2>
  //           <pre className="text-sm bg-gray-100 p-4 rounded whitespace-pre-wrap">
  //             {JSON.stringify(analysis.extracted, null, 2)}
  //           </pre>
  //         </div>

  //         {/* Refinement names used */}
  //         {analysis.refinementNames.length > 0 && (
  //           <div>
  //             <h2 className="font-bold text-lg mb-2">Refinement Names</h2>
  //             <p className="text-sm">{analysis.refinementNames.join(", ")}</p>
  //           </div>
  //         )}

  //         {/* Resolved case */}
  //         <div>
  //           <h2 className="font-bold text-lg mb-2">Resolved Case</h2>
  //           <div className="border p-4 rounded">
  //             <p className="font-bold">
  //               {analysis.resolved.selectedCase.title}
  //             </p>
  //             <p className="text-sm text-gray-500">
  //               Source: {analysis.resolved.selectedCase.source} —
  //               Score: {analysis.resolved.selectedCase.score} —
  //               Confidence: {analysis.resolved.confidence}
  //             </p>
  //             <p className="text-sm mt-2 italic">
  //               {analysis.resolved.reasoning}
  //             </p>
  //             {analysis.resolved.selectedCase.url && (
  //               <a
  //                 href={analysis.resolved.selectedCase.url}
  //                 target="_blank"
  //                 rel="noopener noreferrer"
  //                 className="text-blue-500 text-sm"
  //               >
  //                 View source
  //               </a>
  //             )}
  //           </div>
  //         </div>

  //         {/* Wikipedia summary */}
  //         {analysis.wikiSummary && (
  //           <div>
  //             <h2 className="font-bold text-lg mb-2">Wikipedia</h2>
  //             {analysis.wikiThumbnail && (
  //               <img
  //                 src={analysis.wikiThumbnail}
  //                 alt="case thumbnail"
  //                 className="mb-2 rounded"
  //               />
  //             )}
  //             <p className="text-sm">{analysis.wikiSummary}</p>
  //             {analysis.wikiUrl && (
  //               <a
  //                 href={analysis.wikiUrl}
  //                 target="_blank"
  //                 rel="noopener noreferrer"
  //                 className="text-blue-500 text-sm"
  //               >
  //                 Read full article
  //               </a>
  //             )}
  //           </div>
  //         )}

  //         {/* All candidates */}
  //         <div>
  //           <h2 className="font-bold text-lg mb-2">All Candidates</h2>
  //           {analysis.candidates.map((c, i) => (
  //             <div key={i} className="border p-3 mb-2 rounded">
  //               <p className="font-bold">{c.title}</p>
  //               <p className="text-sm text-gray-500">
  //                 {c.source} — score: {c.score}
  //               </p>
  //               {c.snippet && (
  //                 <p
  //                   className="text-sm mt-1"
  //                   dangerouslySetInnerHTML={{ __html: c.snippet }}
  //                 />
  //               )}
  //               {c.url && (
  //                 <a
  //                   href={c.url}
  //                   target="_blank"
  //                   rel="noopener noreferrer"
  //                   className="text-blue-500 text-sm"
  //                 >
  //                   View
  //                 </a>
  //               )}
  //             </div>
  //           ))}
  //         </div>
  //       </div>
  //     )}
  //   </main>
  // );
}
