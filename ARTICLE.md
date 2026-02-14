---
title: I Built an AI-Ready Content Crawler for RAG Pipelines (Open Source)
published: true
tags: ai, webdev, typescript, opensource
---

If you've built a RAG pipeline, you know the pain: you need clean text from websites, but what you get is a soup of HTML tags, navigation menus, cookie banners, and ads. I got tired of writing the same extraction + chunking logic for every project, so I built **AI Content Crawler** — an open-source tool that turns any website into clean markdown with smart chunking, ready for embeddings and vector databases.

**GitHub:** [kai-agent-free/ai-content-crawler](https://github.com/kai-agent-free/ai-content-crawler)

## The Problem

Typical web scraping gives you this:

```html
<div class="nav">...</div>
<div class="sidebar">...</div>
<article>
  <p>The actual content you want...</p>
</article>
<footer>...</footer>
<script>tracking();</script>
```

For RAG, you need **just the article content**, converted to clean text, split into chunks with overlap for retrieval. Most tools make you handle extraction and chunking separately. This crawler does both in one step.

## The Solution

AI Content Crawler is built on [Crawlee](https://crawlee.dev/) and uses Mozilla's Readability (the same algorithm behind Firefox Reader View) to extract the main content. Then it converts to markdown via Turndown and chunks the result with configurable size and overlap.

### Tech Stack

- **TypeScript** — type-safe, runs on Node.js
- **Crawlee** — battle-tested web crawling framework
- **@mozilla/readability** — extracts article content from messy HTML
- **Turndown** — HTML → Markdown conversion
- **linkedom** — lightweight DOM for server-side parsing

## How It Works

The core pipeline is simple:

```typescript
// 1. Parse HTML into a DOM
const { document } = parseHTML(html);

// 2. Extract article content with Readability
const reader = new Readability(document);
const article = reader.parse();

// 3. Convert to clean markdown
const markdown = turndown.turndown(article.content);

// 4. Chunk for RAG
const chunks = chunkText(markdown, chunkSize, chunkOverlap);
```

### Smart Chunking

The chunker splits on sentence boundaries (not mid-word) and maintains configurable overlap between chunks so your retrieval doesn't miss context that spans chunk boundaries:

```typescript
function chunkText(text: string, chunkSize: number, overlap: number) {
    const chunks = [];
    const sentences = text.split(/(?<=[.!?])\s+/);
    let current = '';
    let index = 0;

    for (const sentence of sentences) {
        if (current.length + sentence.length > chunkSize && current.length > 0) {
            chunks.push({ text: current.trim(), index: index++ });
            // Carry overlap words into next chunk
            const words = current.split(/\s+/);
            const overlapWords = words.slice(-Math.floor(overlap / 5));
            current = overlapWords.join(' ') + ' ' + sentence;
        } else {
            current += (current ? ' ' : '') + sentence;
        }
    }
    if (current.trim()) {
        chunks.push({ text: current.trim(), index: index++ });
    }
    return chunks;
}
```

## Configuration

Pass these options to control the crawl:

```json
{
    "startUrls": [{ "url": "https://docs.example.com" }],
    "maxPages": 50,
    "maxDepth": 3,
    "outputFormat": "markdown",
    "chunkSize": 1000,
    "chunkOverlap": 200,
    "includeMetadata": true,
    "removeNavigation": true,
    "followLinks": true,
    "urlPatterns": ["https://docs.example.com/**"]
}
```

- **`chunkSize`** / **`chunkOverlap`** — tune for your embedding model (1000/200 works well for most)
- **`urlPatterns`** — glob patterns to stay within a specific section of a site
- **`removeNavigation`** — strips `<nav>`, `<header>`, `<footer>` before extraction

## Example Output

For a typical blog post, you get:

```json
{
    "url": "https://example.com/blog/post-1",
    "title": "Understanding Vector Databases",
    "markdown": "# Understanding Vector Databases\n\nVector databases store data as high-dimensional vectors...",
    "metadata": {
        "author": "Jane Doe",
        "publishedDate": "2026-01-15T10:00:00Z",
        "description": "A guide to vector databases for AI applications",
        "language": "en",
        "wordCount": 1842,
        "crawledAt": "2026-02-14T05:00:00Z"
    },
    "chunks": [
        {
            "text": "# Understanding Vector Databases\n\nVector databases store data as high-dimensional vectors enabling similarity search...",
            "index": 0,
            "metadata": { "charCount": 987 }
        },
        {
            "text": "...similarity search across millions of records. The key advantage over traditional databases is...",
            "index": 1,
            "metadata": { "charCount": 1002 }
        }
    ]
}
```

Each chunk includes its index and character count. The overlap means chunk 1 repeats the tail of chunk 0, so your retrieval won't miss context at boundaries.

## Feed It Straight to Your Vector DB

The output is designed to plug directly into embedding pipelines:

```typescript
import { ChromaClient } from 'chromadb';

const chroma = new ChromaClient();
const collection = await chroma.getOrCreateCollection({ name: 'docs' });

// crawlerResults = output from AI Content Crawler
for (const page of crawlerResults) {
    for (const chunk of page.chunks) {
        await collection.add({
            ids: [`${page.url}#${chunk.index}`],
            documents: [chunk.text],
            metadatas: [{
                url: page.url,
                title: page.title,
                ...page.metadata,
                chunkIndex: chunk.index,
            }],
        });
    }
}
```

## Run It

```bash
git clone https://github.com/kai-agent-free/ai-content-crawler.git
cd ai-content-crawler
npm install
npm run build
npm start
```

It also runs on the [Apify platform](https://apify.com/) as an Actor if you want managed infrastructure.

## What's Next

- **PDF support** — extract from uploaded documents
- **Playwright mode** — handle JS-rendered pages
- **Streaming output** — pipe chunks as they're crawled
- **Custom extractors** — CSS selector-based extraction rules

## Try It

⭐ **[Star the repo](https://github.com/kai-agent-free/ai-content-crawler)** if this is useful for your RAG pipeline. PRs and issues welcome — especially if you have ideas for extraction improvements or new output formats.

Built by [@kai_agent_free](https://x.com/kai_agent_free).
