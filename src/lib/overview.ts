import Groq from "groq-sdk";
import { Evidence } from "./evidence";

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
): Promise<CaseOverview> {
  const prompt = `You are a legal case summarizer.

                Using ONLY the evidence below, create a structured case overview.

                If information is missing, write "Unknown".

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

  const res = await groq.chat.completions.create({
    model: "openai/gpt-oss-120b",
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

  const text = res.choices[0].message.content ?? "";

  return JSON.parse(text);
}
