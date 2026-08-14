import Groq from "groq-sdk";
import { ExtractedCase, ScoredCandidate } from "./types";
import { redis } from "./redis";

// Legacy local type — resolve.ts is no longer part of the active pipeline
// (see docs/rag), but is retained for reference.
interface ResolvedCase {
  selectedCase: ScoredCandidate;
  confidence: number;
  reasoning: string;
}

// Retained locally since the shared CACHE_TTL no longer exposes a resolve key.
const RESOLVE_TTL = 60 * 60 * 24;

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY!,
});

export async function resolveCase(
  extracted: ExtractedCase,
  candidates: ScoredCandidate[],
  model: string,
  url: string,
): Promise<ResolvedCase | null> {
  const key = `resolve:${url}`;
  const cached = await redis.get<ResolvedCase>(key);
  if (cached) {
    console.log("Resolve cache HIT");
    return cached;
  }

  if (candidates.length === 0) return null;

  // Take top 3 candidates by score
  const top = candidates.slice(0, 3);

  const prompt = `You are a legal case identifier. Given the extracted case signals from a true crime video transcript and a list of candidate cases from search results, determine which candidate best matches the described case.

                  NOTE: Extracted names may be phonetically inaccurate due to speech-to-text errors. Prioritize matches on location, year, crime type, and keywords over exact name matches.

                  Extracted signals:
                  ${JSON.stringify(extracted, null, 2)}

                  Candidates:
                  ${top
                    .map(
                      (c, i) => `
                  Candidate ${i + 1}:
                  - Title: ${c.title}
                  - Source: ${c.source}
                  - Score: ${c.score}
                  - Snippet: ${c.snippet ?? "none"}
                  - Metadata: ${JSON.stringify(c.metadata ?? {})}
                  `,
                    )
                    .join("\n")}

                  Return ONLY valid JSON with no markdown, no code blocks, no explanation:
                  {
                    "selectedIndex": 0,
                    "confidence": 0.0,
                    "reasoning": "string"
                  }

                  selectedIndex is the 0-based index of the best matching candidate.
                  confidence is a number between 0 and 1.
                  reasoning is a brief explanation of why this candidate was selected.`;

  const completion = await groq.chat.completions.create({
    model: model ?? "openai/gpt-oss-120b",
    temperature: 0.1,
    messages: [
      {
        role: "system",
        content:
          "You are a legal case resolver. Return ONLY valid JSON with no markdown, no code blocks, no explanation.",
      },
      { role: "user", content: prompt },
    ],
  });

  const text = completion.choices[0].message.content?.trim() ?? "";

  try {
    const result = JSON.parse(text) as {
      selectedIndex: number;
      confidence: number;
      reasoning: string;
    };

    const selected = top[result.selectedIndex] ?? top[0];

    const topResult = {
      selectedCase: selected,
      confidence: result.confidence,
      reasoning: result.reasoning,
    };

    await redis.set(key, topResult, { ex: RESOLVE_TTL });
    console.log("Resolve cache MISS");

    return topResult;
  } catch {
    console.error("Resolve: failed to parse LLM response:", text);
    // Fall back to highest scored candidate
    return {
      selectedCase: top[0],
      confidence: top[0].score,
      reasoning: "Fallback to highest scored candidate due to parse error.",
    };
  }
}
