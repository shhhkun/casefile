import Groq from "groq-sdk";
import { ExtractedCase } from "./types";

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY!,
});

interface CorrectedNames {
  defendant: string | null;
  victim: string | null;
}

export async function correctNames(
  extracted: ExtractedCase
): Promise<ExtractedCase> {
  // If we have no names to correct, skip the LLM call
  if (!extracted.defendant && !extracted.victim) {
    console.log("Correct: no names to correct, skipping");
    return extracted;
  }

  const prompt = `You are a criminal case name correction specialist.

Given this criminal case context extracted from a speech-to-text transcript:
- Crime type: ${extracted.crimeType ?? "unknown"}
- State: ${extracted.state ?? "unknown"}
- Year: ${extracted.approximateYear ?? "unknown"}
- Jurisdiction: ${extracted.jurisdiction ?? "unknown"}
- Keywords: ${extracted.keywords?.join(", ") ?? "none"}

The following names were extracted from speech-to-text and may contain phonetic errors:
- Defendant: "${extracted.defendant ?? "unknown"}"
- Victim: "${extracted.victim ?? "unknown"}"

Using your knowledge of criminal cases, correct the spelling of these names if you recognize the case.
If you are not confident about a correction, return the original name as-is.
Do NOT invent names you are not confident about.

Return ONLY valid JSON with no markdown, no code blocks, no explanation:
{
  "defendant": "corrected name or original if uncertain",
  "victim": "corrected name or original if uncertain"
}`;

  try {
    const completion = await groq.chat.completions.create({
      model: "openai/gpt-oss-120b",
      messages: [
        {
          role: "system",
          content:
            "You are a criminal case name correction specialist. Return ONLY valid JSON.",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.1,
    });

    const text = completion.choices[0].message.content?.trim() ?? "";
    console.log("Correct: raw LLM response:", text);

    const corrected = JSON.parse(text) as CorrectedNames;
    console.log("Correct: corrected names:", JSON.stringify(corrected, null, 2));

    return {
      ...extracted,
      defendant: corrected.defendant ?? extracted.defendant,
      victim: corrected.victim ?? extracted.victim,
    };
  } catch (err) {
    console.error("Correct: failed, using original names:", err);
    return extracted;
  }
}