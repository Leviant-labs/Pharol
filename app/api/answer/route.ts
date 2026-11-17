import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import {
  AnswerCitation,
  AnswerFollowUpTurn,
  InstantAnswer,
  KnowledgeBox,
  SearchResult,
  UnifiedAnswer,
} from '@/lib/search-types';
import { extractDomain } from '@/lib/search-engine';

interface AnswerRequestBody {
  query: string;
  results?: SearchResult[];
  knowledgeBox?: KnowledgeBox | null;
  instantAnswer?: InstantAnswer | null;
  followUpQuestion?: string;
  followUpHistory?: AnswerFollowUpTurn[];
}

function cleanSynthesisText(raw: string): string {
  return raw
    .replace(/\(\s*\/[^;()]*\/\s*;\s*/g, '')
    .replace(/\(\s*\/[^)]*\/\s*\)/g, '')
    .replace(/\(\s*;\s*/g, '')
    .replace(/\(\s*\)/g, '')
    .replace(/\b(Introduction|Background|Methods|Results|Conclusion|Conclusions|Discussion|Objective|Purpose)([A-Z][a-z])/g, '$1: $2')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function formatCitationLabel(r: SearchResult): string {
  const dom = extractDomain(r.url);
  if (dom === 'doi.org') {
    if (r.journal && r.journal.length <= 26) return r.journal;
    if (r.engine) return `${r.engine} · doi`;
  }
  return dom;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as AnswerRequestBody;
    const query = body.query?.trim();
    if (!query) {
      return NextResponse.json({ error: 'Missing query' }, { status: 400 });
    }

    const followUpQuestion = body.followUpQuestion?.trim();
    const followUpHistory = Array.isArray(body.followUpHistory) ? body.followUpHistory : [];
    const rawResults = body.results || [];
    const kb = body.knowledgeBox;
    const instant = body.instantAnswer;

    // Prefer diverse domains across the top 7 citations so the Sources bar isn't filled with duplicate hosts
    const diverseResults: SearchResult[] = [];
    const seenDomains = new Set<string>();
    const seenUrls = new Set<string>();

    for (const r of rawResults) {
      if (!r.url || seenUrls.has(r.url)) continue;
      const domKey = extractDomain(r.url) === 'doi.org' ? `${r.engine}-${r.journal || r.url}` : extractDomain(r.url);
      if (!seenDomains.has(domKey)) {
        seenDomains.add(domKey);
        seenUrls.add(r.url);
        diverseResults.push(r);
      }
      if (diverseResults.length >= 7) break;
    }
    for (const r of rawResults) {
      if (diverseResults.length >= 7) break;
      if (!r.url || seenUrls.has(r.url)) continue;
      seenUrls.add(r.url);
      diverseResults.push(r);
    }

    const topResults = diverseResults;

    const citations: AnswerCitation[] = topResults.map((r, i) => ({
      index: i + 1,
      title: r.title,
      url: r.url,
      domain: formatCitationLabel(r),
      engine: r.engine,
    }));

    const buildFollowUpFallback = (question: string): AnswerFollowUpTurn => {
      const qTerms = question
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 2);
      const scored = topResults
        .map((r, idx) => {
          const hay = `${r.title} ${r.snippet}`.toLowerCase();
          const score = qTerms.reduce((acc, t) => acc + (hay.includes(t) ? 1 : 0), 0);
          return { r, idx, score };
        })
        .sort((a, b) => b.score - a.score);

      const best = scored.slice(0, 2).filter((s) => s.r.snippet);
      if (best.length === 0) {
        return {
          question,
          answer: `No specific match found in the indexed sources for "${question}". Try running a dedicated search.`,
          citations: [],
          provider: 'instant-synthesis',
        };
      }

      const answer = best
        .map((b) => `${cleanSynthesisText(b.r.snippet)} [${b.idx + 1}]`)
        .join(' ');
      return {
        question,
        answer,
        citations: best.map((b) => citations[b.idx]),
        provider: 'instant-synthesis',
      };
    };

    const buildFallbackAnswer = (): UnifiedAnswer => {
      const hasLocalizedKb = Boolean(
        kb?.extract && kb.url && kb.url.includes('.wikipedia.org') && !kb.url.includes('en.wikipedia.org')
      );
      const rawLead =
        (hasLocalizedKb ? kb?.extract : instant?.text || kb?.extract) ||
        topResults[0]?.snippet ||
        `Aggregated search overview for "${query}".`;
      let leadText = cleanSynthesisText(rawLead);
      if (leadText.length > 360) {
        const sentenceCut = leadText.slice(0, 360).lastIndexOf('. ');
        leadText = sentenceCut > 140 ? leadText.slice(0, sentenceCut + 1) : `${leadText.slice(0, 357)}...`;
      }

      const leadPrefix = leadText.slice(0, 22).toLowerCase();
      const keyPoints: string[] = [];

      for (let idx = 0; idx < topResults.length && keyPoints.length < 3; idx++) {
        const r = topResults[idx];
        const cleanedSnippet = cleanSynthesisText(r.snippet || '');
        if (!cleanedSnippet) continue;
        if (cleanedSnippet.slice(0, 22).toLowerCase() === leadPrefix) continue;
        if (r.engine.includes('wikipedia') && leadText.toLowerCase().includes(r.title.split(' — ')[0].toLowerCase().slice(0, 16))) {
          continue;
        }
        if (/^(Authors:|AccessScience|[A-Z][a-z]+ [A-Z]{1,2}\.)/.test(cleanedSnippet) && cleanedSnippet.length < 110) {
          continue;
        }
        const trimmed =
          cleanedSnippet.length > 155
            ? `${cleanedSnippet.slice(0, 152).replace(/\s+\S*$/, '')}...`
            : cleanedSnippet;
        keyPoints.push(`${r.title}: ${trimmed} [${idx + 1}]`);
      }

      if (keyPoints.length < 2) {
        for (let idx = 0; idx < topResults.length && keyPoints.length < 3; idx++) {
          const r = topResults[idx];
          const cleanedSnippet = cleanSynthesisText(r.snippet || '');
          if (!cleanedSnippet || cleanedSnippet.slice(0, 42).toLowerCase() === leadPrefix) continue;
          const alreadyUsed = keyPoints.some((kp) => kp.includes(`[${idx + 1}]`));
          if (alreadyUsed) continue;
          const trimmed = cleanedSnippet.length > 155 ? `${cleanedSnippet.slice(0, 152)}...` : cleanedSnippet;
          keyPoints.push(`${r.title}: ${trimmed} [${idx + 1}]`);
        }
      }

      return {
        summary: leadText,
        keyPoints,
        citations: citations.slice(0, 5),
        provider: 'instant-synthesis',
        query,
      };
    };

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      if (followUpQuestion) {
        return NextResponse.json(buildFollowUpFallback(followUpQuestion));
      }
      return NextResponse.json(buildFallbackAnswer());
    }

    // Lightly enrich top 2 non-Wikipedia URLs with page text (1.4s budget) for faster Gemini grounding
    const enrichedSnippets = new Map<number, string>();
    if (!followUpQuestion) {
      await Promise.allSettled(
        topResults.slice(0, 2).map(async (r, i) => {
          if (!r.url || r.url.includes('wikipedia.org')) return;
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 1400);
          try {
            const res = await fetch(`https://r.jina.ai/${r.url}`, {
              headers: { Accept: 'text/plain' },
              signal: controller.signal,
            });
            if (res.ok) {
              const md = await res.text();
              const bodyIdx = md.indexOf('Markdown Content:');
              const body = (bodyIdx >= 0 ? md.slice(bodyIdx + 17) : md)
                .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
                .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
                .replace(/\s+/g, ' ')
                .trim()
                .slice(0, 900);
              if (body.length > 180) enrichedSnippets.set(i, body);
            }
          } catch {
            // keep original snippet
          } finally {
            clearTimeout(timer);
          }
        })
      );
    }

    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });

    const contextLines = topResults
      .map((r, i) => {
        const extra = enrichedSnippets.get(i);
        return `[${i + 1}] Title: ${r.title}\nSource: ${extractDomain(r.url)} (${r.engine})${
          r.publishedDate ? ` · ${r.publishedDate}` : ''
        }\nSnippet: ${r.snippet}${extra ? `\nExtracted Excerpt: ${extra}` : ''}`;
      })
      .join('\n\n');

    if (followUpQuestion) {
      const historyBlock =
        followUpHistory.length > 0
          ? `Previous turns:\n${followUpHistory
              .slice(-4)
              .map((t) => `Q: ${t.question}\nA: ${t.answer}`)
              .join('\n\n')}`
          : '';

      const followUpPrompt = [
        `Original Search Query: "${query}"`,
        kb?.extract ? `Encyclopedia Context (${kb.source}): ${kb.extract}` : '',
        `Retrieved Sources:\n${contextLines}`,
        historyBlock,
        `Follow-up Question: "${followUpQuestion}"`,
      ]
        .filter(Boolean)
        .join('\n\n');

      try {
        const response = await ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: followUpPrompt,
          config: {
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            systemInstruction:
              'Answer the user follow-up question concisely in 2-4 factual sentences using only the retrieved search sources. ' +
              'Cite supporting sources inline with [n]. Answer in the language of the follow-up question. Never fabricate URLs or facts.',
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                answer: { type: Type.STRING },
                citedIndices: { type: Type.ARRAY, items: { type: Type.INTEGER } },
              },
              required: ['answer', 'citedIndices'],
            },
          },
        });

        const parsed = JSON.parse((response.text ?? '{}').trim()) as {
          answer?: string;
          citedIndices?: number[];
        };
        const citedSet = new Set(parsed.citedIndices || []);
        const turn: AnswerFollowUpTurn = {
          question: followUpQuestion,
          answer: parsed.answer || buildFollowUpFallback(followUpQuestion).answer,
          citations:
            citedSet.size > 0
              ? citations.filter((c) => citedSet.has(c.index))
              : citations.slice(0, 3),
          provider: 'gemini-grounded',
        };
        return NextResponse.json(turn);
      } catch {
        return NextResponse.json(buildFollowUpFallback(followUpQuestion));
      }
    }

    const prompt = [
      `User Query: "${query}"`,
      kb?.extract ? `Encyclopedia Context (${kb.source}): ${kb.extract}` : '',
      instant?.text && instant.text !== kb?.extract
        ? `Instant Answer (${instant.source}): ${instant.text}`
        : '',
      `Top Metasearch Sources:\n${contextLines}`,
    ]
      .filter(Boolean)
      .join('\n\n');

    try {
      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: prompt,
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          systemInstruction:
            'You synthesize unified search engine answers like Kagi/Perplexity from retrieved metasearch snippets and page excerpts. ' +
            'Write a crisp, objective, factual 2-3 sentence summary directly answering the query with inline citation markers like [1], [2]. ' +
            'Also provide 3 concise bullet keyPoints (each citing [n] where supported). ' +
            'Respond in the language of the query when clear (e.g. Portuguese queries in Portuguese, English in English). Ground every claim strictly in the provided sources.',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              summary: {
                type: Type.STRING,
                description: 'Concise 2-3 sentence synthesized answer with [n] inline citations.',
              },
              keyPoints: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: 'Up to 3 concise factual bullet points with [n] citations.',
              },
              citedIndices: {
                type: Type.ARRAY,
                items: { type: Type.INTEGER },
                description: '1-based source numbers referenced in the summary or keyPoints.',
              },
            },
            required: ['summary', 'keyPoints', 'citedIndices'],
          },
        },
      });

      const rawText = (response.text ?? '{}').trim();
      const parsed = JSON.parse(rawText) as {
        summary?: string;
        keyPoints?: string[];
        citedIndices?: number[];
      };

      const citedSet = new Set(parsed.citedIndices || []);
      const activeCitations =
        citedSet.size > 0
          ? citations.filter((c) => citedSet.has(c.index))
          : citations.slice(0, 4);

      const unified: UnifiedAnswer = {
        summary: parsed.summary || buildFallbackAnswer().summary,
        keyPoints: Array.isArray(parsed.keyPoints) ? parsed.keyPoints.slice(0, 3) : [],
        citations: activeCitations,
        provider: 'gemini-grounded',
        query,
      };

      return NextResponse.json(unified);
    } catch {
      return NextResponse.json(buildFallbackAnswer());
    }
  } catch {
    return NextResponse.json(
      {
        summary: 'Unable to synthesize unified answer right now. Browse the ranked sources below.',
        keyPoints: [],
        citations: [],
        provider: 'instant-synthesis',
        query: '',
      } satisfies UnifiedAnswer,
      { status: 200 }
    );
  }
}
