import Groq from "groq-sdk";
import { Evidence } from "./evidence";
import { redis } from "./redis";
import { CACHE_TTL } from "./cache";

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY!,
});

export interface CaseOverview {
  summary: string;
  timeline: string[];
  people: { name: string; role: string }[];
  legalOutcome: string;
  faq: { question: string; answer: string }[];
}

export async function generateOverview(
  evidence: Evidence,
  model: string,
  url: string,
): Promise<CaseOverview> {
  const key = `overview:${url}`;
  const cached = await redis.get<CaseOverview>(key);
  if (cached) {
    console.log("Overview cache HIT");
    return cached;
  }

  const prompt = `You are a legal case summarizer.

                  Using ONLY the evidence below, create a structured case overview.

                  If information is missing, write "Unknown".

                  IMPORTANT INSTRUCTIONS:
                  - caseInfo contains structured case metadata and corrected entity names.
                  - Prefer caseInfo values over names found in originalText.
                  - originalText may contain transcription errors.

                  EVIDENCE:
                  ${JSON.stringify(evidence, null, 2)}

                  Return ONLY valid JSON in this format:

                  {
                  "summary": "...",
                  "timeline": ["..."],
                  "people": [
                      { "name": "...", "role": "..." }
                  ],
                  "legalOutcome": "...",
                  "faq": [
                      { "question": "...", "answer": "..." }
                  ]
                  }
                  `;

  const completion = await groq.chat.completions.create({
    model: model ?? "openai/gpt-oss-120b",
    temperature: 0.2,
    messages: [
      {
        role: "system",
        content: "Return only valid JSON.",
      },
      {
        role: "user",
        content: prompt,
      },
    ],
  });

  let text = (completion.choices[0].message.content ?? "").trim();

  // Remove any markdown json wrapping
  text = text
    .trim()
    .replace(/^```(?:json)?\s*/, "")
    .replace(/\s*```$/, "");

  const parsed = JSON.parse(text) as CaseOverview;

  await redis.set(key, parsed, { ex: CACHE_TTL.overview });
  console.log("Overview cache MISS");

  return parsed;
}
