import { Actor } from 'apify';
import { CheerioCrawler } from 'crawlee';
import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import TurndownService from 'turndown';
function chunkText(text, chunkSize, overlap) {
    const chunks = [];
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
        }
        else {
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
const input = await Actor.getInput() ?? {};
const { startUrls = [], maxPages = 100, maxDepth = 3, outputFormat = 'markdown', chunkSize = 1000, chunkOverlap = 200, includeMetadata = true, removeNavigation = true, followLinks = true, urlPatterns = [], } = input;
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
    async requestHandler({ request, $, enqueueLinks, log }) {
        const url = request.loadedUrl || request.url;
        log.info(`Processing: ${url}`);
        // Get full HTML for Readability
        const html = $.html();
        const { document } = parseHTML(html);
        // Extract with Readability
        const reader = new Readability(document);
        const article = reader.parse();
        if (!article) {
            log.warning(`No content extracted from ${url}`);
            return;
        }
        // Convert to markdown
        const markdown = turndown.turndown(article.content);
        const plainText = article.textContent.replace(/\s+/g, ' ').trim();
        const result = {
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
            delete result.metadata;
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
