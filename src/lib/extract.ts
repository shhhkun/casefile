import Groq from "groq-sdk";
import { ExtractedCase } from "./types";

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY!,
});

export async function extractCase(transcript: string): Promise<ExtractedCase> {
  const completion = await groq.chat.completions.create({
    model: "openai/gpt-oss-120b",
    messages: [
      {
        role: "system",
        content:
          "You are a legal case identifier. Return ONLY valid JSON with no markdown, no code blocks, no explanation.",
      },
      {
        role: "user",
        content: `Analyze this text and extract structured information about the primary criminal case being described.

                  IMPORTANT INSTRUCTIONS:
                  - Extract full legal names including middle names where available (e.g. "Hadden Irving Clark" not "Hadden Clark")
                  - Treat extracted names as potentially noisy if source is a speech-to-text transcript
                  - Treat location, year, crime type, and keywords as the most reliable signals
                  - For defendant and victim, always prefer the most complete name available

                  Use this exact structure:
                  {
                    "caseName": "string or null",
                    "defendant": "string or null",
                    "victim": "string or null",
                    "crimeType": "string or null",
                    "jurisdiction": "string or null",
                    "state": "string or null",
                    "approximateYear": "string or null",
                    "keywords": ["string"],
                    "confidence": "high | medium | low"
                  }

                  Text:
                  ${transcript.slice(0, 12000)}`,
      },
    ],
    temperature: 0.1,
  });

  const text = completion.choices[0].message.content?.trim() ?? "";
  console.log("Extract: raw response:", text);

  try {
    const parsed = JSON.parse(text) as ExtractedCase;
    console.log("Extract: parsed:", JSON.stringify(parsed, null, 2));
    return parsed;
  } catch {
    throw new Error(`Failed to parse extraction response: ${text}`);
  }
}
