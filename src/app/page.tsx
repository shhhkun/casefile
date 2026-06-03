"use client";

import { useState } from "react";

interface ExtractedCase {
  caseName: string | null;
  defendant: string | null;
  victim: string | null;
  crimeType: string | null;
  jurisdiction: string | null;
  state: string | null;
  approximateYear: string | null;
  keywords: string[];
  confidence: "high" | "medium" | "low";
}

interface CourtResult {
  id: string;
  caseName: string;
  court: string;
  dateFiled: string;
  url: string;
  snippet: string;
}

interface WikiArticle {
  title: string;
  summary: string;
  url: string;
  thumbnail: string | null;
}

export default function Home() {
  const [url, setUrl] = useState("");
  const [extracted, setExtracted] = useState<ExtractedCase | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [results, setResults] = useState<CourtResult[]>([]);
  const [wikiArticle, setWikiArticle] = useState<WikiArticle | null>(null);

  const handleSubmit = async () => {
    setLoading(true);
    setError("");
    setExtracted(null);
    setResults([]);
    setWikiArticle(null);

    try {
      // Step 1: fetch transcript
      const transcriptRes = await fetch("/api/transcript", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });

      const transcriptData = await transcriptRes.json();

      if (!transcriptRes.ok) {
        setError(transcriptData.error);
        return;
      }

      // Step 2: extract entities
      const extractRes = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript: transcriptData.transcript }),
      });

      const extractData = await extractRes.json();

      if (!extractRes.ok) {
        setError(extractData.error);
        return;
      }

      setExtracted(extractData.extracted);

      // Step 3: search Wikipedia
      const wikiRes = await fetch("/api/wiki", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ extracted: extractData.extracted }),
      });

      const wikiData = await wikiRes.json();
      setWikiArticle(wikiData.article ?? null);

      // Step 4: search CourtListener
      const searchRes = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ extracted: extractData.extracted }),
      });

      const searchData = await searchRes.json();
      setResults(searchData.results ?? []);
    } catch (err) {
      setError("Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="p-8">
      <input
        type="text"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="Paste YouTube URL"
        className="border p-2 w-full mb-4"
      />
      <button
        onClick={handleSubmit}
        disabled={loading}
        className="bg-black text-white px-4 py-2"
      >
        {loading ? "Processing..." : "Analyze Video"}
      </button>

      {error && <p className="text-red-500 mt-4">{error}</p>}

      {extracted && (
        <div className="mt-6">
          <h2 className="font-bold text-lg mb-2">Extracted Case Info</h2>
          <pre className="text-sm bg-gray-100 text-black p-4 rounded whitespace-pre-wrap">
            {JSON.stringify(extracted, null, 2)}
          </pre>
        </div>
      )}

      {wikiArticle && (
        <div className="mt-6">
          <h2 className="font-bold text-lg mb-2">Wikipedia</h2>
          {wikiArticle.thumbnail && (
            <img
              src={wikiArticle.thumbnail}
              alt={wikiArticle.title}
              className="mb-2 rounded"
            />
          )}
          <p className="font-bold">{wikiArticle.title}</p>
          <p className="text-sm mt-2">{wikiArticle.summary}</p>
          <a
            href={wikiArticle.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-500 text-sm"
          >
            Read full article
          </a>
        </div>
      )}

      <div className="mt-6">
        <h2 className="font-bold text-lg mb-2">Court Records Found</h2>
        {results.length === 0 ? (
          <p className="text-sm text-gray-500">No appellate records found.</p>
        ) : (
          results.map((r, i) => (
            <div key={i} className="border p-4 mb-2 rounded">
              <p className="font-bold">{r.caseName}</p>
              <p className="text-sm text-gray-500">
                {r.court} - {r.dateFiled}
              </p>
              <p className="text-sm mt-1">{r.snippet}</p>
              <a
                href={`https://www.courtlistener.com${r.url}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-500 text-sm"
              >
                View on CourtListener
              </a>
            </div>
          ))
        )}
      </div>
    </main>
  );
}
