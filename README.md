# CaseFile

Analyze legal content from online sources and transform it into structured case overviews. CaseFile uses AI-assisted processing to extract case information, search relevant legal sources, and generate summaries from complex and unstructured content.

[**Website**](https://casefile-demo.vercel.app/)

## Features

- **AI-Powered Case Analysis:** Extracts relevant legal information from articles and YouTube videos to identify potential cases and generate structured overviews.

- **Multi-Source Retrieval:** Searches external sources such as CourtListener and Wikipedia to gather supporting information and improve case identification.

- **Pipeline-Based Processing:** Uses a multi-stage workflow to extract metadata, rank potential matches, and generate final case summaries.

- **External API Integration:** Connects multiple APIs and services into a unified analysis workflow.

## Some Technologies Used

- **Groq API:** Used for LLM-powered information extraction, case resolution, and structured summary generation.

- **CourtListener API:** Used to retrieve legal opinions and case records.

- **Wikipedia API:** Used to gather additional case and involved-party context.

- **Next.js / TypeScript:** Used to build the full-stack web application and workflow.

## Pipeline Design

CaseFile uses a multi-stage processing pipeline to transform unstructured online content into structured legal case analysis.

1. **Content Extraction**
   - Extracts text from supported sources such as YouTube videos and online articles.

2. **Metadata Extraction**
   - Uses LLM-powered processing to identify relevant case information and generate structured metadata from extracted content.

3. **Case Retrieval**
   - Searches external legal and public sources, including CourtListener and Wikipedia, to find relevant case records and supporting context.

4. **Candidate Resolution**
   - Evaluates retrieved results and determines the most likely matching case based on extracted information.

5. **Case Overview Generation**
   - Generates a structured summary using gathered evidence and processed information.

The pipeline is designed to handle noisy and incomplete source material by separating extraction, retrieval, validation, and generation into distinct stages.

## Running server

To run the development server:

```bash
npm run dev
```
