import * as dotenv from "dotenv";
import { join } from "path";
import {
  ingestSource,
  retrieveChunks,
  chunkText,
  embedTexts,
  deleteExpiredSources,
  closePool,
} from "../src/rag";

// Load .env.local for DATABASE_URL.
dotenv.config({ path: join(process.cwd(), ".env.local") });

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("Missing DATABASE_URL in .env.local");
    process.exit(1);
  }

  // Run cleanup first to remove any expired sources.
  const deleted = await deleteExpiredSources();
  console.log(`[cleanup] deleted ${deleted} expired source(s)`);

  // Multi-paragraph source text (mimics an article/transcript about a criminal
  // case). Long enough to produce multiple chunks, proving that pgvector
  // retrieval surfaces the most *relevant* chunk, not just any chunk.
  const sourceText = `
The People v. John Smith case involved a 1994 bank robbery in downtown Chicago.
Witnesses reported that the suspect entered the First National Bank on State Street
at approximately 2:30 PM. The robbery occurred in broad daylight and was captured
on multiple security cameras. Law enforcement identified the suspect through
fingerprint analysis and eyewitness testimony. The trial lasted three weeks in
Cook County Circuit Court. The jury deliberated for six hours before returning
a guilty verdict. The defendant was sentenced to fifteen years in state prison.

The case was significant for its use of surveillance footage as the primary
evidence. Defense attorneys argued that the footage was grainy and unreliable,
and they attempted to suppress it as evidence. The prosecution countered that
the footage clearly showed the defendant's distinctive green jacket and the
handgun used in the robbery. After extensive expert testimony, the judge ruled
the footage admissible. This ruling was later upheld on appeal and became a
referenced precedent in other bank robbery cases throughout the state.

During the investigation, detectives also uncovered a series of similar
robberies in the surrounding suburbs that were connected through matching
ballistics reports. The defendant's fingerprints were recovered from a
getaway vehicle that had been reported stolen two days before the robbery.
DNA evidence found on a hat left at the scene further tied the defendant to
the crime. The state's attorney described the evidence as overwhelming and
called the investigation a model of modern police forensics.
`.trim();

  const queryText =
    "What was the outcome of the Chicago bank robbery trial in Cook County?";

  // Use a small chunk size so the persisted source genuinely has multiple
  // chunks, proving pgvector retrieval surfaces the *most relevant* chunk.
  const chunkOptions = { chunkSize: 200, overlap: 40 };

  console.log("\n[ingest] chunking + embedding + storing source...");
  const ingestResult = await ingestSource(
    {
      url: "https://example.com/mock-case-1",
      sourceType: "article",
      title: "Mock Chicago Bank Robbery Case",
      sourceText,
      extractedMeta: {
        state: "Illinois",
        crimeType: "bank robbery",
        approximateYear: "1994",
      },
    },
    chunkOptions,
  );

  console.log(
    `[ingest] source=${ingestResult.sourceId} chunks=${ingestResult.chunkCount} reused=${ingestResult.reused}`,
  );

  // Demonstrate chunking independently (same options used during ingestion).
  const chunks = chunkText(sourceText, chunkOptions);
  console.log(`[chunk] produced ${chunks.length} chunks (chunkSize=200)`);

  // Ingest a second, related source to demonstrate cross-source retrieval.
  console.log("\n[ingest] storing a second related source...");
  const secondText = `
During the 1994 Chicago crime wave, bank robberies were a focus of the FBI.
The Cook County task force coordinated with local police to close several cases.
One particular defendant, known for wearing a green jacket, was tied to a series
of armed robberies in the downtown area. Surveillance and forensic evidence,
including ballistics and DNA, played a key role in the convictions.
`.trim();
  const secondIngest = await ingestSource(
    {
      url: "https://example.com/mock-case-2",
      sourceType: "article",
      title: "Mock Chicago Crime Wave",
      sourceText: secondText,
      extractedMeta: { state: "Illinois", crimeType: "bank robbery" },
    },
    chunkOptions,
  );
  console.log(
    `[ingest] second source=${secondIngest.sourceId} chunks=${secondIngest.chunkCount} reused=${secondIngest.reused}`,
  );

  // Demonstrate embedding independently.
  const embeddings = await embedTexts(chunks.map((c) => c.text));
  console.log(
    `[embed] produced ${embeddings.length} embeddings (dim=${embeddings[0]?.length ?? 0})`,
  );
  if (embeddings[0]) {
    console.log(
      `[embed] sample embedding first values: ${embeddings[0].slice(0, 5).join(", ")}`,
    );
  }

  // Retrieve the top-k semantically similar chunks.
  console.log(`\n[retrieve] query: "${queryText}"`);
  const results = await retrieveChunks(queryText, { topK: 3 });

  if (results.length === 0) {
    console.log("[retrieve] no results returned.");
  } else {
    for (const r of results) {
      console.log(
        `[retrieve] chunk=${r.chunkIndex} similarity=${r.similarity.toFixed(4)} source=${r.sourceUrl}`,
      );
      console.log(`           text: ${r.text.slice(0, 120)}...`);
    }
  }

  // Retrieve current-source-only (priority) results.
  console.log(
    `\n[retrieve] current-source-only (sourceId=${ingestResult.sourceId})`,
  );
  const currentSourceResults = await retrieveChunks(queryText, {
    topK: 2,
    sourceId: ingestResult.sourceId,
  });
  console.log(
    `[retrieve] current-source results: ${currentSourceResults.length}`,
  );

  // Re-ingest the same source to demonstrate dedup/reuse.
  console.log("\n[dedup] re-ingesting same URL...");
  const reingest = await ingestSource({
    url: "https://example.com/mock-case-1",
    sourceType: "article",
    sourceText,
  });
  console.log(`[dedup] source=${reingest.sourceId} reused=${reingest.reused}`);

  await closePool();
  console.log("\nDemo complete.");
}

main().catch((err) => {
  console.error("Demo failed:", err);
  process.exit(1);
});
