import * as dotenv from "dotenv";
import { join } from "path";
import { writeFileSync, mkdirSync } from "fs";
import { retrieveChunks, closePool } from "../src/rag";
import { RetrievedChunk } from "../src/rag/types";

// Load .env.local for DATABASE_URL.
dotenv.config({ path: join(process.cwd(), ".env.local") });

const TOP_K = 3;

interface EvalQuery {
  id: string;
  sourceUrl: string;
  query: string;
}

interface QueryResult {
  id: string;
  query: string;
  sourceUrl: string;
  caseName: string;
  topKResults: RetrievedChunk[];
  relevantInTopK: number;
  firstRelevantRank: number; // 1-indexed, 0 if none
  recall: number;
  precision: number;
  mrr: number;
}

/**
 * Derive the case name from the query id.
 *
 * queries.json ids are slugs like "hadden-clark-01", "travis-alexander-02",
 * etc. The part before the trailing "-NN" is the case slug, which we
 * convert to a display name ("Hadden Clark", "Travis Alexander", ...).
 *
 * This gives us a case-level ground truth that does NOT depend on the
 * stored sourceUrl of a chunk: a chunk is relevant if it references the
 * same case as the query, even if it was ingested under a different URL
 * (e.g. a Wikipedia article about the case, a CourtListener opinion, etc.).
 */
function caseNameFromId(id: string): string {
  const slug = id.replace(/-\d+$/, "");
  return slug
    .split("-")
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(" ");
}

/**
 * Is a retrieved chunk relevant to a query?
 *
 * Simple ground-truth heuristic: the chunk is relevant if its text mentions
 * the case name (e.g. "Hadden Clark"), or if its source URL path contains
 * the underscored case slug (e.g. ".../wiki/Hadden_Clark"). This matches
 * chunks that discuss the case regardless of which URL they were ingested
 * under, and avoids requiring an exact match between the query's sourceUrl
 * and the retrieved chunk's sourceUrl.
 */
function isRelevant(chunk: RetrievedChunk, queryId: string): boolean {
  const slug = queryId.replace(/-\d+$/, "");
  const caseName = caseNameFromId(queryId);

  const text = chunk.text.toLowerCase();
  const url = chunk.sourceUrl.toLowerCase();
  const urlSlug = slug.replace(/-/g, "_");

  return text.includes(caseName.toLowerCase()) || url.includes(urlSlug);
}

/**
 * Evaluate a single query against the RAG database. Retrieval-only: the
 * database is already populated, so we never ingest or modify sources.
 */
async function evaluateQuery(q: EvalQuery): Promise<QueryResult> {
  const results = await retrieveChunks(q.query, { topK: TOP_K });

  // Determine which retrieved chunks reference the query's case.
  const relevantInTopK = results.filter((r) => isRelevant(r, q.id)).length;

  // Find the rank of the first relevant result (1-indexed).
  let firstRelevantRank = 0;
  for (let i = 0; i < results.length; i++) {
    if (isRelevant(results[i], q.id)) {
      firstRelevantRank = i + 1;
      break;
    }
  }

  // Metrics. We do NOT use DB chunk counts as the Recall denominator.
  // Instead, each query is treated as having at least one relevant
  // document in the corpus (binary relevance): Recall@K is 1 when any
  // relevant chunk is retrieved in the top-K, otherwise 0.
  const recall = relevantInTopK > 0 ? 1 : 0;
  const precision = relevantInTopK / TOP_K;
  const mrr = firstRelevantRank > 0 ? 1 / firstRelevantRank : 0;

  return {
    id: q.id,
    query: q.query,
    sourceUrl: q.sourceUrl,
    caseName: caseNameFromId(q.id),
    topKResults: results,
    relevantInTopK,
    firstRelevantRank,
    recall,
    precision,
    mrr,
  };
}

/**
 * Calculate aggregate metrics for a set of query results.
 */
function aggregateMetrics(results: QueryResult[]): {
  recall: number;
  precision: number;
  mrr: number;
} {
  if (results.length === 0) {
    return { recall: 0, precision: 0, mrr: 0 };
  }
  const sum = results.reduce(
    (acc, r) => ({
      recall: acc.recall + r.recall,
      precision: acc.precision + r.precision,
      mrr: acc.mrr + r.mrr,
    }),
    { recall: 0, precision: 0, mrr: 0 },
  );
  return {
    recall: sum.recall / results.length,
    precision: sum.precision / results.length,
    mrr: sum.mrr / results.length,
  };
}

/**
 * Format a number as a percentage with 1 decimal place.
 */
function fmtPct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

/**
 * Format a number to 4 decimal places.
 */
function fmtNum(n: number): string {
  return n.toFixed(4);
}

/**
 * Generate a human-readable group label from a sourceUrl.
 */
function groupLabel(sourceUrl: string): string {
  try {
    const u = new URL(sourceUrl);
    return `${u.hostname}${u.pathname}`;
  } catch {
    return sourceUrl;
  }
}

/**
 * Build the markdown report.
 */
function buildReport(
  allResults: QueryResult[],
  groupResults: Map<string, QueryResult[]>,
): string {
  const lines: string[] = [];

  lines.push("# RAG Evaluation Report");
  lines.push("");
  lines.push(`**Date:** ${new Date().toISOString()}`);
  lines.push(`**Top-K:** ${TOP_K}`);
  lines.push(`**Total queries:** ${allResults.length}`);
  lines.push(`**Groups:** ${groupResults.size}`);
  lines.push("");
  lines.push(
    "**Ground truth:** a retrieved chunk is relevant if it references the query's case name (derived from the query id slug) in its text or retrieved chunk source URL. Recall@3 is binary (1 if at least one relevant chunk is in the top-3).",
  );
  lines.push("");

  // Overall metrics
  const overall = aggregateMetrics(allResults);
  lines.push("## Overall Metrics");
  lines.push("");
  lines.push("| Metric | Value |");
  lines.push("| ------ | ----- |");
  lines.push(`| Recall@${TOP_K} | ${fmtPct(overall.recall)} |`);
  lines.push(`| Precision@${TOP_K} | ${fmtPct(overall.precision)} |`);
  lines.push(`| MRR | ${fmtNum(overall.mrr)} |`);
  lines.push("");

  // Per-group metrics
  lines.push("## Per-Group Metrics");
  lines.push("");
  lines.push("| Source | Case | Queries | Recall@3 | Precision@3 | MRR |");
  lines.push("| ------ | ---- | ------- | -------- | ----------- | --- |");
  for (const [sourceUrl, results] of groupResults) {
    const metrics = aggregateMetrics(results);
    const caseName = results[0]?.caseName ?? "—";
    lines.push(
      `| ${groupLabel(sourceUrl)} | ${caseName} | ${results.length} | ${fmtPct(metrics.recall)} | ${fmtPct(metrics.precision)} | ${fmtNum(metrics.mrr)} |`,
    );
  }
  lines.push("");

  // Per-query breakdown
  lines.push("## Per-Query Breakdown");
  lines.push("");
  for (const r of allResults) {
    lines.push(`### ${r.id}`);
    lines.push("");
    lines.push(`**Query:** ${r.query}`);
    lines.push(`**Case:** ${r.caseName} (${r.sourceUrl})`);
    lines.push(`**Relevant in top-${TOP_K}:** ${r.relevantInTopK}`);
    lines.push(`**First relevant rank:** ${r.firstRelevantRank || "— (none)"}`);
    lines.push(
      `**Recall@${TOP_K}:** ${fmtPct(r.recall)} | **Precision@${TOP_K}:** ${fmtPct(r.precision)} | **MRR:** ${fmtNum(r.mrr)}`,
    );
    lines.push("");
    lines.push("**Top 3 results:**");
    lines.push("");
    lines.push("| Rank | Source URL | Similarity | Text (first 120 chars) |");
    lines.push("| ---- | ---------- | ---------- | ---------------------- |");
    for (let i = 0; i < r.topKResults.length; i++) {
      const chunk = r.topKResults[i];
      const relevant = isRelevant(chunk, r.id);
      const textPreview = chunk.text.slice(0, 120).replace(/\n/g, " ");
      const relevanceTag = relevant ? " ✅" : "";
      lines.push(
        `| ${i + 1}${relevanceTag} | ${chunk.sourceUrl} | ${fmtNum(chunk.similarity)} | ${textPreview} |`,
      );
    }
    if (r.topKResults.length === 0) {
      lines.push("| — | No results returned | — | — |");
    }
    lines.push("");
  }

  return lines.join("\n");
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("Missing DATABASE_URL in .env.local");
    process.exit(1);
  }

  // Load queries.
  const queriesPath = join(process.cwd(), "evaluation", "queries.json");
  const queriesData = await import("fs").then((fs) =>
    fs.readFileSync(queriesPath, "utf-8"),
  );
  const { queries }: { queries: EvalQuery[] } = JSON.parse(queriesData);

  console.log(`Loaded ${queries.length} evaluation queries`);

  // Group queries by sourceUrl.
  const groupResults = new Map<string, QueryResult[]>();
  const allResults: QueryResult[] = [];

  for (const q of queries) {
    console.log(`\nEvaluating: ${q.id}`);
    console.log(`  Query: ${q.query}`);
    console.log(`  Source URL: ${q.sourceUrl}`);

    const result = await evaluateQuery(q);
    allResults.push(result);

    if (!groupResults.has(q.sourceUrl)) {
      groupResults.set(q.sourceUrl, []);
    }
    groupResults.get(q.sourceUrl)!.push(result);

    console.log(`  Results: ${result.relevantInTopK} relevant in top-${TOP_K}`);
    console.log(
      `  Recall@${TOP_K}: ${fmtPct(result.recall)} | Precision@${TOP_K}: ${fmtPct(result.precision)} | MRR: ${fmtNum(result.mrr)}`,
    );
  }

  // Build and write report.
  const report = buildReport(allResults, groupResults);

  const outputDir = join(process.cwd(), "script-results");
  mkdirSync(outputDir, { recursive: true });
  const outputPath = join(outputDir, "rag-evaluation.md");
  writeFileSync(outputPath, report, "utf-8");

  console.log(`\nReport written to: ${outputPath}`);

  // Print summary to console.
  const overall = aggregateMetrics(allResults);
  console.log("\n=== Overall Metrics ===");
  console.log(`Recall@${TOP_K}: ${fmtPct(overall.recall)}`);
  console.log(`Precision@${TOP_K}: ${fmtPct(overall.precision)}`);
  console.log(`MRR: ${fmtNum(overall.mrr)}`);

  console.log("\n=== Per-Group Metrics ===");
  for (const [sourceUrl, results] of groupResults) {
    const metrics = aggregateMetrics(results);
    console.log(`\n${groupLabel(sourceUrl)} (${results.length} queries):`);
    console.log(`  Recall@${TOP_K}: ${fmtPct(metrics.recall)}`);
    console.log(`  Precision@${TOP_K}: ${fmtPct(metrics.precision)}`);
    console.log(`  MRR: ${fmtNum(metrics.mrr)}`);
  }

  await closePool();
  console.log("\nEvaluation complete.");
}

main().catch((err) => {
  console.error("Evaluation failed:", err);
  process.exit(1);
});
