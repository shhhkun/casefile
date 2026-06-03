import Groq from "groq-sdk";
import { NextRequest, NextResponse } from "next/server";

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY!,
});

export async function POST(req: NextRequest) {
  try {
    const { transcript } = await req.json();
    console.log(
      "Extract: received transcript length:",
      transcript?.length ?? 0,
    );

    if (!transcript) {
      console.log("Extract: no transcript provided");
      return NextResponse.json(
        { error: "Transcript is required" },
        { status: 400 },
      );
    }

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
          content: `Analyze this true crime video transcript and extract structured information about the primary criminal case.

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

                    Transcript:
                    ${transcript.slice(0, 8000)}`,
        },
      ],
      temperature: 0.1,
    });

    const text = completion.choices[0].message.content?.trim() ?? "";
    console.log("Extract: raw LLM response:", text);

    let extracted;
    try {
      extracted = JSON.parse(text);
      console.log(
        "Extract: parsed result:",
        JSON.stringify(extracted, null, 2),
      );
    } catch {
      console.log("Extract: failed to parse JSON");
      return NextResponse.json(
        { error: "Failed to parse LLM response", raw: text },
        { status: 500 },
      );
    }

    return NextResponse.json({ extracted });
  } catch (error) {
    console.error("Extract: unexpected error:", error);
    return NextResponse.json({ error: "Extraction failed" }, { status: 500 });
  }
}
