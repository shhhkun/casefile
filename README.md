# CaseFile

Analyze legal content from online sources and transform it into structured case overviews. CaseFile uses AI-assisted processing, external legal sources, and Retrieval-Augmented Generation (RAG) to extract case information, retrieve relevant evidence, and generate structured summaries from complex and unstructured content.

[**Website**](https://casefile-demo.vercel.app/)

## Features

- **AI-Powered Case Analysis:** Extracts relevant legal information from articles and YouTube videos, identifying case details from noisy and unstructured source material.

- **Multi-Source Retrieval:** Searches external sources such as CourtListener and Wikipedia to gather legal records and supporting context.

- **Retrieval-Augmented Generation (RAG):** Ingests full CourtListener opinions and Wikipedia articles into a persistent vector knowledge base, chunks and embeds their contents, and retrieves semantically relevant passages during case analysis.

- **Persistent Vector Knowledge Base:** Reuses previously ingested documents and embeddings across requests while using TTL-based expiration to keep the shared knowledge base bounded.

- **Structured AI Generation:** Uses LLMs to extract case metadata and generate structured case overviews containing summaries, timelines, people, legal outcomes, and FAQs.

- **Pipeline-Based Processing:** Separates source extraction, metadata extraction, external search, evidence assembly, RAG retrieval, and final generation into distinct stages.

- **External API Integration:** Connects multiple APIs and services into a unified analysis workflow.

## Some Technologies Used

- **Groq API (GPT-OSS-120B):** Used for LLM-powered metadata extraction and structured case overview generation.

- **Transformers.js:** Runs local open-source embedding models in-process, avoiding dependency on paid embedding APIs.

- **Supabase PostgreSQL + pgvector:** Stores document chunks, embeddings, and RAG metadata and performs vector similarity search.

- **CourtListener API:** Used to search legal records and retrieve full legal opinions for RAG ingestion.

- **Wikipedia API:** Used to gather additional case context and retrieve full articles for RAG ingestion.

- **Redis (Upstash):** Used for TTL-based application caching to reduce redundant LLM inference and external API requests.

- **Next.js / TypeScript:** Used to build the full-stack application and analysis pipeline.

- **Vercel:** Used for deployment.

## Pipeline Design

CaseFile uses a multi-stage processing pipeline to transform unstructured online content into structured legal case overviews.

1. **Content Extraction**

   - Extracts text from supported sources such as YouTube videos and online articles.

2. **Metadata Extraction**

   - Uses an LLM to identify relevant case information and generate structured metadata from the extracted content.

3. **External Search**

   - Searches CourtListener and Wikipedia using the extracted case signals to find relevant legal records and supporting context.

4. **Evidence Assembly**

   - Combines the extracted case information, original source content, CourtListener results, and Wikipedia context.
   - Retrieves the full underlying documents of the top CourtListener and Wikipedia results when available.

5. **RAG Ingestion & Retrieval**

   - Chunks and embeds retrieved documents using local Transformers.js embeddings.
   - Stores chunks and vectors in Supabase PostgreSQL with pgvector.
   - Reuses previously ingested documents when available.
   - Retrieves semantically relevant chunks from the shared knowledge base and adds them to the evidence supplied to the final LLM.

6. **Case Overview Generation**

   - Uses the gathered evidence and retrieved RAG context to generate a structured case overview containing a summary, timeline, people, legal outcome, and frequently asked questions.

The pipeline is designed to handle noisy and incomplete source material by separating extraction, retrieval, evidence assembly, and generation into distinct stages. RAG augments the existing retrieval pipeline rather than replacing external search, allowing CaseFile to combine keyword-based legal retrieval with semantic document retrieval.

## Running server

To run the development server:

```bash
npm run dev
```

## Running tests

To run playwright tests:

```bash
npm run test
```

To view the test report via web browser:

```bash
npm run test:report
```

To run RAG demo:

```bash
npm run rag:demo
```
