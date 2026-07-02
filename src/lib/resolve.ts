import Groq from "groq-sdk";
import { ExtractedCase, ScoredCandidate, ResolvedCase } from "./types";

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY!,
});

export async function resolveCase(
  extracted: ExtractedCase,
  candidates: ScoredCandidate[],
): Promise<ResolvedCase | null> {
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
    model: "openai/gpt-oss-120b",
    messages: [
      {
        role: "system",
        content:
          "You are a legal case resolver. Return ONLY valid JSON with no markdown, no code blocks, no explanation.",
      },
      { role: "user", content: prompt },
    ],
    temperature: 0.1,
  });

  const text = completion.choices[0].message.content?.trim() ?? "";

  try {
    const result = JSON.parse(text) as {
      selectedIndex: number;
      confidence: number;
      reasoning: string;
    };

    const selected = top[result.selectedIndex] ?? top[0];

    return {
      selectedCase: selected,
      confidence: result.confidence,
      reasoning: result.reasoning,
    };
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
