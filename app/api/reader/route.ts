import { NextRequest, NextResponse } from 'next/server';
import * as cheerio from 'cheerio';
import { ReaderBlock, ReaderContent } from '@/lib/search-types';
import { requestProviders } from '@/lib/provider-credentials';
import {
  classifySourceAccess,
  decodeHtmlEntities,
  extractBingTargetUrl,
  extractDomain,
  hasSubscriptionJsonLd,
  isDeepWikiErrorText,
  parseJinaMarkdownToReader,
  parseMcpJsonRpcPayload,
} from '@/lib/search-engine';

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 6000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

/**
 * Unwrap Bing or Google News redirect wrappers if present
 */
async function resolveTargetUrl(rawUrl: string): Promise<string> {
  const unwrapped = extractBingTargetUrl(rawUrl);
  if (unwrapped !== rawUrl) return unwrapped;

  if (rawUrl.includes('news.google.com/')) {
    try {
      const res = await fetchWithTimeout(
        rawUrl,
        { redirect: 'follow', headers: { 'User-Agent': BROWSER_UA } },
        4000
      );
      if (res.url && !res.url.includes('news.google.com/')) {
        return res.url;
      }
      const html = await res.text();
      const canonical = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i)?.[1];
      if (canonical && !canonical.includes('news.google.com/')) return canonical;
      const dataUrl = html.match(/data-n-au=["']([^"']+)["']/i)?.[1];
      if (dataUrl && dataUrl.startsWith('http')) return dataUrl;
    } catch {
      // continue with original
    }
  }
  return rawUrl;
}

/**
 * Wikipedia specialized full-article extractor (MediaWiki Extracts API)
 */
async function tryWikipediaReader(targetUrl: string): Promise<ReaderContent | null> {
  const match = targetUrl.match(/^https?:\/\/([a-z]{2,3})\.wikipedia\.org\/wiki\/([^#?]+)/i);
  if (!match) return null;

  const lang = match[1];
  const slug = decodeURIComponent(match[2]);
  try {
    const apiUrl = `https://${lang}.wikipedia.org/w/api.php?action=query&prop=extracts|pageimages|info&inprop=url&pithumbsize=1000&explaintext=1&titles=${encodeURIComponent(slug)}&format=json&redirects=1`;
    const res = await fetchWithTimeout(
      apiUrl,
      { headers: { 'User-Agent': 'SearXMinimal/1.0 (reader)' } },
      4500
    );
    if (!res.ok) return null;
    const data = await res.json();
    const pages = data.query?.pages || {};
    const page = Object.values(pages)[0] as any;
    if (!page || page.missing || !page.extract) return null;

    const rawExtract: string = page.extract;
    const blocks: ReaderBlock[] = [];
    const paragraphs: string[] = [];

    for (const line of rawExtract.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const h2Match = trimmed.match(/^==\s*([^=]+?)\s*==$/);
      const h3Match = trimmed.match(/^===\s*([^=]+?)\s*===$/);
      if (h3Match) {
        blocks.push({ type: 'h3', text: h3Match[1] });
        paragraphs.push(h3Match[1]);
      } else if (h2Match) {
        const heading = h2Match[1];
        if (['See also', 'References', 'External links', 'Further reading', 'Notes'].includes(heading)) {
          break;
        }
        blocks.push({ type: 'h2', text: heading });
        paragraphs.push(heading);
      } else if (!trimmed.startsWith('=') && trimmed.length > 20) {
        blocks.push({ type: 'p', text: trimmed });
        paragraphs.push(trimmed);
      }
      if (blocks.length >= 65) break;
    }

    const words = paragraphs.join(' ').split(/\s+/).length;
    return {
      url: targetUrl,
      resolvedUrl: page.fullurl || targetUrl,
      title: page.title || slug.replace(/_/g, ' '),
      siteName: 'Wikipedia',
      heroImage: page.thumbnail?.source,
      paragraphs,
      blocks,
      readingTimeMinutes: Math.max(1, Math.round(words / 220)),
      type: 'article',
      extractor: 'wikipedia',
      isFallback: false,
    };
  } catch {
    return null;
  }
}

/**
 * Tier 4B: Keyless Firecrawl v2 Scrape fallback (no Authorization header)
 */
async function tryFirecrawlReader(resolvedUrl: string, key?: string): Promise<ReaderContent | null> {
  try {
    const res = await fetchWithTimeout(
      'https://api.firecrawl.dev/v2/scrape',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(key ? { Authorization: `Bearer ${key}` } : {}),
        },
        body: JSON.stringify({ url: resolvedUrl, formats: ['markdown'], onlyMainContent: true }),
      },
      7000
    );
    if (!res.ok) return null;
    const json = await res.json();
    const md: string = json?.data?.markdown || '';
    if (!md || md.length < 200) return null;

    const parsed = parseJinaMarkdownToReader(`Markdown Content:\n${md}`, resolvedUrl);
    if (parsed.paragraphs.length === 0) return null;

    const meta = json?.data?.metadata || {};
    const words = parsed.paragraphs.join(' ').split(/\s+/).length;
    return {
      url: resolvedUrl,
      resolvedUrl,
      title: meta.title || parsed.title || extractDomain(resolvedUrl),
      publishedTime: meta.publishedTime || parsed.publishedTime,
      siteName: meta.ogSiteName || extractDomain(resolvedUrl),
      heroImage: meta.ogImage || parsed.heroImage,
      paragraphs: parsed.paragraphs,
      blocks: parsed.blocks,
      readingTimeMinutes: Math.max(1, Math.round(words / 210)),
      type: 'article',
      extractor: 'firecrawl',
      isFallback: false,
    };
  } catch {
    return null;
  }
}

/**
 * Tier 4C: Keenable Public MCP Page Reader fallback
 */
async function tryKeenableReader(resolvedUrl: string, key?: string): Promise<ReaderContent | null> {
  try {
    const res = await fetchWithTimeout(
      key
        ? 'https://api.keenable.ai/mcp'
        : 'https://api.keenable.ai/mcp-public',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          ...(key ? { 'X-API-Key': key } : {}),
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'fetch_page_content',
            arguments: { url: resolvedUrl, output_format: 'json' },
          },
        }),
      },
      6500
    );
    if (!res.ok) return null;
    const raw = await res.text();
    const inner = parseMcpJsonRpcPayload(raw);
    if (!inner) return null;

    let md = inner;
    let title: string | undefined;
    let publishedTime: string | undefined;
    if (inner.trim().startsWith('{')) {
      try {
        const obj = JSON.parse(inner);
        md = obj.content || obj.markdown || obj.text || '';
        title = obj.title;
        publishedTime = obj.published_at;
      } catch {
        // treat as markdown text
      }
    }
    if (!md || md.length < 200) return null;

    const parsed = parseJinaMarkdownToReader(`Markdown Content:\n${md}`, resolvedUrl);
    if (parsed.paragraphs.length === 0) return null;

    const words = parsed.paragraphs.join(' ').split(/\s+/).length;
    return {
      url: resolvedUrl,
      resolvedUrl,
      title: title || parsed.title || extractDomain(resolvedUrl),
      publishedTime: publishedTime || parsed.publishedTime,
      siteName: extractDomain(resolvedUrl),
      heroImage: parsed.heroImage,
      paragraphs: parsed.paragraphs,
      blocks: parsed.blocks,
      readingTimeMinutes: Math.max(1, Math.round(words / 210)),
      type: 'article',
      extractor: 'keenable',
      isFallback: false,
    };
  } catch {
    return null;
  }
}

/**
 * arXiv specialized full abstract & metadata extractor
 */
async function tryArxivReader(targetUrl: string): Promise<ReaderContent | null> {
  const match = targetUrl.match(/arxiv\.org\/(?:abs|pdf)\/([0-9.]+(?:v\d+)?)/i);
  if (!match) return null;
  const arxivId = match[1];
  try {
    const res = await fetchWithTimeout(`https://export.arxiv.org/api/query?id_list=${encodeURIComponent(arxivId)}`, {}, 4500);
    if (!res.ok) return null;
    const xml = await res.text();
    const $ = cheerio.load(xml, { xmlMode: true });
    const entry = $('entry').first();
    if (entry.length === 0) return null;

    const title = entry.find('title').text().replace(/\s+/g, ' ').trim();
    const summary = entry.find('summary').text().replace(/\s+/g, ' ').trim();
    const published = entry.find('published').text().trim();
    const authors = entry
      .find('author > name')
      .map((_, el) => $(el).text().trim())
      .get()
      .join(', ');
    const categories = entry
      .find('category')
      .map((_, el) => $(el).attr('term'))
      .get()
      .filter(Boolean)
      .join(', ');

    const blocks: ReaderBlock[] = [
      { type: 'h2', text: 'Abstract' },
      { type: 'p', text: summary },
    ];
    if (categories) {
      blocks.push({ type: 'h3', text: 'Subject Categories' });
      blocks.push({ type: 'p', text: categories });
    }

    return {
      url: targetUrl,
      resolvedUrl: `https://arxiv.org/abs/${arxivId}`,
      title,
      byline: authors || undefined,
      publishedTime: published ? new Date(published).toLocaleDateString() : undefined,
      siteName: 'arXiv Preprint Archive',
      paragraphs: [summary],
      blocks,
      readingTimeMinutes: Math.max(2, Math.round(summary.split(/\s+/).length / 180)),
      type: 'article',
      pdfUrl: `https://arxiv.org/pdf/${arxivId}.pdf`,
      extractor: 'arxiv',
      isFallback: false,
    };
  } catch {
    return null;
  }
}

/**
 * GitHub README extractor for repository URLs
 */
async function tryGitHubReader(targetUrl: string): Promise<ReaderContent | null> {
  const match = targetUrl.match(/^https?:\/\/github\.com\/([^/]+)\/([^/?#]+)\/?$/i);
  if (!match) return null;
  const [, owner, repo] = match;
  try {
    const res = await fetchWithTimeout(
      `https://api.github.com/repos/${owner}/${repo}/readme`,
      { headers: { 'User-Agent': 'SearXMinimal-Reader', Accept: 'application/vnd.github.raw+json' } },
      4000
    );
    if (!res.ok) return null;
    const md = await res.text();
    const parsed = parseJinaMarkdownToReader(`Markdown Content:\n${md}`, targetUrl);
    return {
      url: targetUrl,
      title: `${owner}/${repo}`,
      siteName: 'GitHub',
      heroImage: parsed.heroImage,
      blocks: parsed.blocks,
      paragraphs: parsed.paragraphs,
      readingTimeMinutes: Math.max(1, Math.round(parsed.paragraphs.join(' ').split(/\s+/).length / 200)),
      type: 'article',
      extractor: 'github',
      isFallback: parsed.paragraphs.length === 0,
    };
  } catch {
    return null;
  }
}

/**
 * DeepWiki MCP wiki contents extractor for deepwiki.com/{owner}/{repo} URLs
 * Falls back cleanly to live GitHub README if DeepWiki has not indexed the repo yet.
 */
async function tryDeepWikiReader(targetUrl: string): Promise<ReaderContent | null> {
  const match = targetUrl.match(/^https?:\/\/deepwiki\.com\/([^/?#]+)\/([^/?#]+)/i);
  if (!match) return null;
  const [, owner, repo] = match;
  const repoSlug = `${owner}/${repo}`;

  const fallbackToGitHub = async (): Promise<ReaderContent> => {
    const notice = `DeepWiki has not indexed ${repoSlug} yet. Showing the live GitHub repository README instead — click Original to trigger indexing on DeepWiki or connect via GitMCP (gitmcp.io/${repoSlug}).`;
    const ghFallback = await tryGitHubReader(`https://github.com/${repoSlug}`);
    if (ghFallback && ghFallback.paragraphs.length > 0) {
      return {
        ...ghFallback,
        url: targetUrl,
        resolvedUrl: targetUrl,
        title: `${repoSlug} — Repository README`,
        siteName: 'DeepWiki → GitHub README',
        accessType: 'open',
        isFallback: true,
        fallbackNotice: notice,
      };
    }
    return {
      url: targetUrl,
      resolvedUrl: targetUrl,
      title: `${repoSlug} — DeepWiki Not Yet Indexed`,
      siteName: 'DeepWiki',
      paragraphs: [
        `DeepWiki has not built an architecture wiki for ${repoSlug} yet (this usually happens for new or low-star repositories).`,
        `You can open DeepWiki via Original above to request indexing, or query live repository files and documentation via GitMCP at https://gitmcp.io/${repoSlug}.`,
      ],
      readingTimeMinutes: 1,
      type: 'article',
      extractor: 'fallback',
      isFallback: true,
      fallbackNotice: `DeepWiki has not indexed ${repoSlug} yet, and no GitHub README was returned.`,
    };
  };

  try {
    const res = await fetchWithTimeout(
      'https://mcp.deepwiki.com/mcp',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'read_wiki_contents',
            arguments: { repoName: repoSlug },
          },
        }),
      },
      7500
    );
    if (!res.ok) return await fallbackToGitHub();
    const raw = await res.text();
    const md = parseMcpJsonRpcPayload(raw);
    if (!md || isDeepWikiErrorText(md) || md.length < 120) {
      return await fallbackToGitHub();
    }

    const parsed = parseJinaMarkdownToReader(`Markdown Content:\n${md}`, targetUrl);
    if (parsed.paragraphs.length === 0) {
      return await fallbackToGitHub();
    }

    const words = parsed.paragraphs.join(' ').split(/\s+/).length;
    return {
      url: targetUrl,
      resolvedUrl: targetUrl,
      title: `${repoSlug} — Architecture & Wiki`,
      siteName: 'DeepWiki',
      heroImage: parsed.heroImage,
      blocks: parsed.blocks,
      paragraphs: parsed.paragraphs,
      readingTimeMinutes: Math.max(1, Math.round(words / 210)),
      type: 'article',
      extractor: 'deepwiki',
      accessType: 'open',
      isFallback: false,
    };
  } catch {
    return await fallbackToGitHub();
  }
}

/**
 * Smart Readability-style HTML extraction using Cheerio
 */
function extractFromHtml(html: string, resolvedUrl: string): ReaderContent {
  const parsedTarget = new URL(resolvedUrl);
  const domain = parsedTarget.hostname.replace(/^www\./, '');
  const $ = cheerio.load(html);

  const ogTitle = $('meta[property="og:title"]').attr('content');
  const twitterTitle = $('meta[name="twitter:title"]').attr('content');
  const h1Text = $('h1').first().text().trim();
  const docTitle = $('title').text().trim();
  const title = decodeHtmlEntities(ogTitle || twitterTitle || h1Text || docTitle || domain);

  const ogSite = $('meta[property="og:site_name"]').attr('content');
  const siteName = ogSite || domain;

  const author =
    $('meta[name="author"]').attr('content') ||
    $('meta[property="article:author"]').attr('content') ||
    $('[rel="author"], .byline, [class*="author-name"]').first().text().trim() ||
    undefined;

  const publishedTime =
    $('meta[property="article:published_time"]').attr('content') ||
    $('meta[name="pubdate"]').attr('content') ||
    $('time').first().attr('datetime') ||
    $('time').first().text().trim() ||
    undefined;

  const ogImage = $('meta[property="og:image"]').attr('content');
  const twitterImage = $('meta[name="twitter:image"]').attr('content');
  const firstImg = $('article img, main img').first().attr('src');
  let heroImage = ogImage || twitterImage || firstImg || undefined;
  if (heroImage && heroImage.startsWith('/')) {
    heroImage = `${parsedTarget.origin}${heroImage}`;
  }

  const description =
    $('meta[name="description"]').attr('content') ||
    $('meta[property="og:description"]').attr('content') ||
    undefined;

  // Strip non-content boilerplate before scoring
  $(
    'script, style, noscript, nav, header, footer, aside, form, iframe, svg, button, [role="navigation"], [role="banner"], [role="contentinfo"], [class*="cookie"], [class*="popup"], [class*="modal"], [class*="newsletter"], [class*="subscribe"], [class*="comment"], [class*="related"], [class*="sidebar"], [class*="share"]'
  ).remove();

  // Score semantic containers first so high bestScore prunes link traversal on generic wrapper divs
  const semanticCandidates = $(
    'article, main, [role="main"], .article-body, .story-body, .entry-content, .post-content, #article-body'
  );
  let bestContainer = $('article').first();
  let bestScore = 0;

  const scoreCandidates = (nodes: cheerio.Cheerio<any>) => {
    nodes.each((_, el) => {
      const node = $(el);
      let pTextLen = 0;
      node.find('p').each((__, p) => {
        const t = $(p).text().trim();
        if (t.length > 40) pTextLen += t.length;
      });
      // Since linkTextLen >= 0, pTextLen - linkTextLen * 0.4 can never exceed pTextLen
      if (pTextLen <= bestScore) return;
      const linkTextLen = node.find('a').text().trim().length;
      const score = pTextLen - linkTextLen * 0.4;
      if (score > bestScore) {
        bestScore = score;
        bestContainer = node;
      }
    });
  };

  scoreCandidates(semanticCandidates);
  if (bestScore < 600) {
    scoreCandidates($('section, div'));
  }

  if (bestContainer.length === 0 || bestScore < 120) {
    bestContainer = $('body');
  }

  const blocks: ReaderBlock[] = [];
  const paragraphs: string[] = [];
  const seenText = new Set<string>();

  bestContainer.find('h2, h3, h4, p, blockquote, pre, ul, ol').each((_, el) => {
    const tag = el.tagName?.toLowerCase();
    if (tag === 'ul' || tag === 'ol') {
      const items = $(el)
        .children('li')
        .map((__, li) => decodeHtmlEntities($(li).text().trim()))
        .get()
        .filter((t) => t.length > 15 && !t.toLowerCase().includes('cookie'));
      if (items.length > 0 && items.length <= 20) {
        blocks.push({ type: 'ul', text: items.join(' • '), items });
        paragraphs.push(items.map((it) => `• ${it}`).join('\n'));
      }
      return;
    }

    const rawText = $(el).text().trim();
    const clean = decodeHtmlEntities(rawText).replace(/\s+/g, ' ').trim();
    if (!clean || seenText.has(clean)) return;

    const lower = clean.toLowerCase();
    if (
      lower.includes('all rights reserved') ||
      lower.includes('accept cookies') ||
      lower.includes('javascript is disabled') ||
      lower.includes('enable javascript')
    ) {
      return;
    }

    if (tag === 'h2') {
      if (clean.length > 3 && clean.length < 180) {
        seenText.add(clean);
        blocks.push({ type: 'h2', text: clean });
        paragraphs.push(clean);
      }
    } else if (tag === 'h3' || tag === 'h4') {
      if (clean.length > 3 && clean.length < 180) {
        seenText.add(clean);
        blocks.push({ type: 'h3', text: clean });
        paragraphs.push(clean);
      }
    } else if (tag === 'blockquote') {
      if (clean.length > 20) {
        seenText.add(clean);
        blocks.push({ type: 'quote', text: clean });
        paragraphs.push(clean);
      }
    } else if (tag === 'pre') {
      if (clean.length > 15) {
        seenText.add(clean);
        blocks.push({ type: 'code', text: rawText });
        paragraphs.push(rawText);
      }
    } else if (clean.length > 35) {
      seenText.add(clean);
      blocks.push({ type: 'p', text: clean });
      paragraphs.push(clean);
    }
  });

  const totalWords = paragraphs.join(' ').split(/\s+/).length;
  return {
    url: resolvedUrl,
    resolvedUrl,
    title: title.trim(),
    byline: author ? decodeHtmlEntities(author) : undefined,
    publishedTime,
    siteName,
    heroImage,
    excerpt: description ? decodeHtmlEntities(description) : undefined,
    paragraphs: paragraphs.slice(0, 50),
    blocks: blocks.slice(0, 50),
    readingTimeMinutes: Math.max(1, Math.round(totalWords / 210)),
    type: 'article',
    extractor: 'direct',
    isFallback: paragraphs.length === 0,
  };
}

/**
 * Tier 3: Keyless Jina Reader (`r.jina.ai`) fallback when direct fetch is blocked or JS-only
 */
async function tryJinaReader(resolvedUrl: string): Promise<ReaderContent | null> {
  try {
    const res = await fetchWithTimeout(
      `https://r.jina.ai/${resolvedUrl}`,
      {
        headers: {
          Accept: 'text/plain',
          'User-Agent': 'SearXMinimal-Reader/1.0',
        },
      },
      7500
    );
    if (!res.ok) return null;
    const md = await res.text();
    if (!md || md.length < 200) return null;

    const parsed = parseJinaMarkdownToReader(md, resolvedUrl);
    if (parsed.paragraphs.length === 0) return null;

    const words = parsed.paragraphs.join(' ').split(/\s+/).length;
    return {
      url: resolvedUrl,
      resolvedUrl,
      title: parsed.title || extractDomain(resolvedUrl),
      publishedTime: parsed.publishedTime,
      siteName: extractDomain(resolvedUrl),
      heroImage: parsed.heroImage,
      paragraphs: parsed.paragraphs,
      blocks: parsed.blocks,
      readingTimeMinutes: Math.max(1, Math.round(words / 210)),
      type: 'article',
      extractor: 'jina-reader',
      isFallback: false,
    };
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const providers = requestProviders(req);
  const { searchParams } = new URL(req.url);
  const rawUrl = searchParams.get('url')?.trim();

  if (!rawUrl) {
    return NextResponse.json({ error: 'Missing target URL' }, { status: 400 });
  }

  try {
    const targetUrl = await resolveTargetUrl(rawUrl);
    const parsedTarget = new URL(targetUrl);
    const domain = parsedTarget.hostname.replace(/^www\./, '');

    // 1. Direct Media / Embeds / PDFs
    const ytMatch = targetUrl.match(
      /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_\-]{11})/
    );
    if (ytMatch) {
      return NextResponse.json({
        url: rawUrl,
        resolvedUrl: targetUrl,
        title: 'YouTube Video Presentation',
        siteName: 'YouTube',
        type: 'video',
        embedUrl: `https://www.youtube-nocookie.com/embed/${ytMatch[1]}`,
        paragraphs: ['Embedded privacy-enhanced stream from YouTube.'],
        readingTimeMinutes: 1,
      } satisfies ReaderContent);
    }

    if (targetUrl.includes('archive.org/details/')) {
      const iaMatch = targetUrl.match(/archive\.org\/details\/([a-zA-Z0-9_\-]+)/);
      if (iaMatch) {
        return NextResponse.json({
          url: rawUrl,
          resolvedUrl: targetUrl,
          title: 'Internet Archive Media Presentation',
          siteName: 'Internet Archive',
          type: 'video',
          embedUrl: `https://archive.org/embed/${iaMatch[1]}`,
          paragraphs: ['Stream from the Internet Archive public digital library.'],
          readingTimeMinutes: 1,
        } satisfies ReaderContent);
      }
    }

    if (/\.(jpe?g|png|gif|webp|svg)(\?.*)?$/i.test(targetUrl)) {
      return NextResponse.json({
        url: rawUrl,
        resolvedUrl: targetUrl,
        title: 'Full Resolution Image Preview',
        siteName: domain,
        type: 'image',
        heroImage: targetUrl,
        paragraphs: ['Direct public image render.'],
        readingTimeMinutes: 1,
      } satisfies ReaderContent);
    }

    if (/\.pdf(\?.*)?$/i.test(targetUrl) || targetUrl.includes('arxiv.org/pdf/')) {
      if (targetUrl.includes('arxiv.org/pdf/')) {
        const arxivRes = await tryArxivReader(targetUrl);
        if (arxivRes) return NextResponse.json(arxivRes);
      }
      return NextResponse.json({
        url: rawUrl,
        resolvedUrl: targetUrl,
        title: 'Academic Document / PDF Paper',
        siteName: domain,
        type: 'pdf',
        pdfUrl: targetUrl,
        paragraphs: ['Rendered PDF document view. Direct download or stream available.'],
        readingTimeMinutes: 5,
      } satisfies ReaderContent);
    }

    // 2. Specialized Clean APIs (Wikipedia, arXiv, GitHub, DeepWiki)
    const wikiRes = await tryWikipediaReader(targetUrl);
    if (wikiRes) return NextResponse.json(wikiRes);

    const arxivRes = await tryArxivReader(targetUrl);
    if (arxivRes) return NextResponse.json(arxivRes);

    const deepwikiRes = await tryDeepWikiReader(targetUrl);
    if (deepwikiRes) return NextResponse.json(deepwikiRes);

    const ghRes = await tryGitHubReader(targetUrl);
    if (ghRes) return NextResponse.json(ghRes);

    // 3. Direct HTML Fetch + Smart Readability Extraction
    const initialAccess = classifySourceAccess(targetUrl);
    let directResult: ReaderContent | null = null;
    let isSchemaSubscription = false;
    let httpStatus = 0;

    try {
      const res = await fetchWithTimeout(
        targetUrl,
        {
          headers: {
            'User-Agent': BROWSER_UA,
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
          },
        },
        5000
      );
      httpStatus = res.status;

      if (res.ok) {
        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('application/pdf')) {
          return NextResponse.json({
            url: rawUrl,
            resolvedUrl: targetUrl,
            title: 'Document PDF',
            siteName: domain,
            type: 'pdf',
            pdfUrl: targetUrl,
            paragraphs: ['PDF stream ready for download or viewing.'],
            readingTimeMinutes: 5,
            accessType: initialAccess,
          } satisfies ReaderContent);
        }

        const html = await res.text();
        isSchemaSubscription = hasSubscriptionJsonLd(html);
        directResult = extractFromHtml(html, res.url || targetUrl);
      }
    } catch {
      // Fall through cleanly
    }

    const detectedAccess =
      initialAccess === 'subscription' || isSchemaSubscription ? 'subscription' : initialAccess;

    const totalDirectChars = directResult ? directResult.paragraphs.join(' ').length : 0;
    if (directResult && directResult.paragraphs.length >= 2 && totalDirectChars >= 350) {
      return NextResponse.json({
        ...directResult,
        url: rawUrl,
        resolvedUrl: targetUrl,
        accessType: detectedAccess,
      });
    }

    // Do not route subscription-gated articles through external extraction; return transparent notice
    if (detectedAccess === 'subscription' && (httpStatus === 401 || httpStatus === 402 || httpStatus === 403 || totalDirectChars < 350)) {
      return NextResponse.json({
        url: rawUrl,
        resolvedUrl: targetUrl,
        title: directResult?.title || `Article on ${domain}`,
        siteName: domain,
        heroImage: directResult?.heroImage,
        excerpt: directResult?.excerpt,
        type: 'article',
        paragraphs: [
          directResult?.excerpt ||
            'This publisher requires an active subscription for full-article access.',
          'Use the Original link above to read or sign in directly on the publisher site.',
        ],
        readingTimeMinutes: 1,
        extractor: 'fallback',
        accessType: 'subscription',
        accessBlocked: true,
        isFallback: true,
      } satisfies ReaderContent);
    }

    // 4. Jina Reader + Firecrawl Keyless + Keenable Public Reader Fallbacks (for open JS-rendered SPAs or thin HTML)
    const externalReader =
      (await tryJinaReader(targetUrl)) ||
      (await tryFirecrawlReader(targetUrl, providers.firecrawlApiKey)) ||
      (await tryKeenableReader(targetUrl, providers.keenableApiKey));
    if (externalReader) {
      if (directResult?.heroImage && !externalReader.heroImage) {
        externalReader.heroImage = directResult.heroImage;
      }
      if (directResult?.byline && !externalReader.byline) {
        externalReader.byline = directResult.byline;
      }
      return NextResponse.json({
        ...externalReader,
        url: rawUrl,
        resolvedUrl: targetUrl,
        accessType: detectedAccess,
      });
    }

    if (directResult && directResult.paragraphs.length > 0) {
      return NextResponse.json({
        ...directResult,
        url: rawUrl,
        resolvedUrl: targetUrl,
        accessType: detectedAccess,
      });
    }

    return NextResponse.json({
      url: rawUrl,
      resolvedUrl: targetUrl,
      title: directResult?.title || `Article on ${domain}`,
      siteName: domain,
      heroImage: directResult?.heroImage,
      excerpt: directResult?.excerpt,
      type: 'article',
      paragraphs: [
        directResult?.excerpt ||
          'This publisher restricts automated server-side extraction or requires interactive browser authentication.',
        'Open the direct publisher link below to read the complete article.',
      ],
      readingTimeMinutes: 1,
      extractor: 'fallback',
      accessType: detectedAccess,
      accessBlocked: true,
      isFallback: true,
    } satisfies ReaderContent);
  } catch {
    return NextResponse.json({ error: 'Unable to render readable content' }, { status: 500 });
  }
}
