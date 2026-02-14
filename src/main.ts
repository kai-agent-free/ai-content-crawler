import { Actor } from 'apify';
import { CheerioCrawler, type CheerioCrawlingContext } from 'crawlee';
import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import TurndownService from 'turndown';

interface InputSchema {
    startUrls: { url: string }[];
    maxPages?: number;
    maxDepth?: number;
    outputFormat?: 'markdown' | 'text' | 'json';
    chunkSize?: number;
    chunkOverlap?: number;
    includeMetadata?: boolean;
    removeNavigation?: boolean;
    followLinks?: boolean;
    urlPatterns?: string[];
}

interface PageResult {
    url: string;
    title: string;
    content: string;
    markdown?: string;
    metadata: {
        author?: string;
        publishedDate?: string;
        description?: string;
        language?: string;
        wordCount: number;
        crawledAt: string;
    };
    chunks?: { text: string; index: number; metadata: Record<string, unknown> }[];
}

function chunkText(text: string, chunkSize: number, overlap: number): { text: string; index: number; metadata: Record<string, unknown> }[] {
    const chunks: { text: string; index: number; metadata: Record<string, unknown> }[] = [];
    const sentences = text.split(/(?<=[.!?])\s+/);
    let current = '';
    let index = 0;

    for (const sentence of sentences) {
        if (current.length + sentence.length > chunkSize && current.length > 0) {
            chunks.push({
                text: current.trim(),
                index: index++,
                metadata: { charCount: current.trim().length },
            });
            // Keep overlap
            const words = current.split(/\s+/);
            const overlapWords = words.slice(-Math.floor(overlap / 5));
            current = overlapWords.join(' ') + ' ' + sentence;
        } else {
            current += (current ? ' ' : '') + sentence;
        }
    }
    if (current.trim()) {
        chunks.push({
            text: current.trim(),
            index: index++,
            metadata: { charCount: current.trim().length },
        });
    }
    return chunks;
}

await Actor.init();

const input = await Actor.getInput<InputSchema>() ?? {} as InputSchema;
const {
    startUrls = [],
    maxPages = 100,
    maxDepth = 3,
    outputFormat = 'markdown',
    chunkSize = 1000,
    chunkOverlap = 200,
    includeMetadata = true,
    removeNavigation = true,
    followLinks = true,
    urlPatterns = [],
} = input;

const turndown = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
});

// Remove unwanted elements
turndown.remove(['script', 'style', 'iframe', 'noscript']);

if (removeNavigation) {
    turndown.remove(['nav', 'header', 'footer']);
}

const crawler = new CheerioCrawler({
    maxRequestsPerCrawl: maxPages,
    maxCrawlDepth: maxDepth,

    async requestHandler({ request, $, enqueueLinks, log }: CheerioCrawlingContext) {
        const url = request.loadedUrl || request.url;
        log.info(`Processing: ${url}`);

        // Get full HTML for Readability
        const html = $.html();
        const { document } = parseHTML(html);

        // Extract with Readability
        const reader = new Readability(document as any);
        const article = reader.parse();

        if (!article) {
            log.warning(`No content extracted from ${url}`);
            return;
        }

        // Convert to markdown
        const markdown = turndown.turndown(article.content);
        const plainText = article.textContent.replace(/\s+/g, ' ').trim();

        const result: PageResult = {
            url,
            title: article.title || $('title').text() || '',
            content: outputFormat === 'text' ? plainText : '',
            metadata: {
                author: article.byline || $('meta[name="author"]').attr('content') || undefined,
                publishedDate: $('meta[property="article:published_time"]').attr('content')
                    || $('time[datetime]').attr('datetime')
                    || undefined,
                description: $('meta[name="description"]').attr('content')
                    || $('meta[property="og:description"]').attr('content')
                    || undefined,
                language: $('html').attr('lang') || undefined,
                wordCount: plainText.split(/\s+/).length,
                crawledAt: new Date().toISOString(),
            },
        };

        if (outputFormat === 'markdown' || outputFormat === 'json') {
            result.markdown = markdown;
        }

        // Smart chunking
        if (chunkSize > 0) {
            const textToChunk = outputFormat === 'markdown' ? markdown : plainText;
            result.chunks = chunkText(textToChunk, chunkSize, chunkOverlap);
        }

        if (!includeMetadata) {
            delete (result as any).metadata;
        }

        await Actor.pushData(result);

        // Follow links
        if (followLinks) {
            await enqueueLinks({
                ...(urlPatterns.length > 0 ? {
                    globs: urlPatterns,
                } : {}),
            });
        }
    },

    failedRequestHandler({ request, log }) {
        log.error(`Failed: ${request.url}`);
    },
});

await crawler.run(startUrls.map(u => u.url));

await Actor.exit();
