import Fuse, { type IFuseOptions } from 'fuse.js';
import type { ClassificationType } from '@prisma/client';
import { normalizeQuery } from '../ingestion/normalize';
import { expandSynonyms } from './synonyms';
import { engineConfig } from './config';

/* ------------------------------------------------------------------ *
 * Types                                                               *
 * ------------------------------------------------------------------ */

export interface AggregatedQuery {
  query: string;
  /** Already-normalized query (produced by pipeline). Classifier is pure; it
   *  does NOT re-normalize — caller is responsible. We re-call normalize() on
   *  raw query only if the caller forgets, for defensiveness. */
  queryNormalized: string;
  occurrenceCount: number;
  resultCount: number;
  clickCount: number;
  hasFilter: boolean;
  filterDimensions: string[];
}

export interface ProductRef {
  id: string;
  shopifyProductId: string;
  title: string;
  tags: string[];
}

export interface SemanticMatchRef {
  productId: string;
  shopifyProductId: string;
  title: string;
  similarity: number;
}

export interface ClassifierInputs {
  aggregate: AggregatedQuery;
  /** Full catalog — used for exact substring + tag matches. */
  products: ProductRef[];
  /** Precomputed top-K semantic matches (from pgvector). Empty → no matches. */
  semanticMatches: SemanticMatchRef[];
}

export interface ClassificationDecision {
  type: ClassificationType | 'NONE';
  confidence: number;
  matchedProductIds: string[];
  lowVolume: boolean;
  reasoning: {
    step: string;
    detail: Record<string, unknown>;
  };
}

/* ------------------------------------------------------------------ *
 * Core                                                                *
 * ------------------------------------------------------------------ */

const FUSE_OPTIONS: IFuseOptions<CorpusEntry> = {
  keys: ['haystack'],
  includeScore: true,
  shouldSort: true,
  ignoreLocation: true,
  // Prune inside Fuse at the same cutoff we enforce below. This used to be 1.0
  // ("we apply the cutoff ourselves"), which means *match everything*: every
  // search returned and sorted the entire corpus — ~15k entries for a 5k-product
  // catalog — and the caller then discarded everything above 0.35. Fuse's
  // threshold is a cutoff on the very same score, so pruning here is behaviour
  // preserving and removes the sort of a full-corpus result set per query. The
  // explicit filter in fuzzyMatch is kept so the cutoff still holds if this
  // option is ever retuned.
  threshold: engineConfig.fuzzyThreshold,
  isCaseSensitive: false,
  minMatchCharLength: 2,
};

/**
 * Decision tree from PRD §9. Pure, deterministic. No DB, no network.
 * Preconditions:
 *   • `aggregate.queryNormalized` is already normalized (see normalize.ts)
 *   • `products` and `semanticMatches` are sorted deterministically by caller
 */
export function classify(inputs: ClassifierInputs): ClassificationDecision {
  const { aggregate, products, semanticMatches } = inputs;
  const qNorm = aggregate.queryNormalized || normalizeQuery(aggregate.query);

  // Step 8 pre-computed (applied to final decision).
  const lowVolume = aggregate.occurrenceCount < engineConfig.lowVolumeCutoff;

  // Step 2 — Filter Gap.
  if (aggregate.hasFilter && aggregate.resultCount === 0) {
    return decide('TYPE_4', 0.95, [], lowVolume, {
      step: 'filter_gap',
      detail: { dimensions: aggregate.filterDimensions },
    });
  }

  // Step 3 — Results but no click.
  if (
    aggregate.resultCount > 0 &&
    aggregate.clickCount === 0 &&
    aggregate.occurrenceCount >= engineConfig.type3OccurrenceMin
  ) {
    return decide('TYPE_3', 0.8, [], lowVolume, {
      step: 'results_no_click',
      detail: {
        resultCount: aggregate.resultCount,
        occurrenceCount: aggregate.occurrenceCount,
      },
    });
  }

  // Step 4 — Exact substring / tag match.
  // If Shopify returned results (resultCount > 0) the product is surfaced — NONE.
  // If resultCount === 0 the product exists in our catalog but Shopify search
  // can't find it — that's a keyword / synonym fix (TYPE_2).
  const exactHit = findExactMatch(qNorm, products);
  if (exactHit) {
    if (aggregate.resultCount > 0) {
      return decide('NONE', 1.0, [exactHit.id], lowVolume, {
        step: 'exact_match',
        detail: { matchedTitle: exactHit.title, exactTerm: qNorm },
      });
    }
    return decide('TYPE_2', 0.9, [exactHit.id], lowVolume, {
      step: 'exact_match_zero_results',
      detail: { matchedTitle: exactHit.title, exactTerm: qNorm },
    });
  }

  // Step 5 — Fuzzy match against titles + tags (synonym-expanded).
  const fuzzy = fuzzyMatch(qNorm, products);
  if (fuzzy) {
    return decide('TYPE_2', 1 - fuzzy.score, fuzzy.topIds, lowVolume, {
      step: 'fuzzy_match',
      detail: {
        fuseScore: fuzzy.score,
        threshold: engineConfig.fuzzyThreshold,
        matchedTerm: fuzzy.matchedTerm,
        expandedQueries: fuzzy.expandedQueries,
      },
    });
  }

  // Step 6 — Semantic match via precomputed top-K.
  const top = semanticMatches[0];
  if (top && top.similarity >= engineConfig.semanticThreshold) {
    const ids = semanticMatches
      .filter((m) => m.similarity >= engineConfig.semanticThreshold)
      .slice(0, 3)
      .map((m) => m.productId);
    return decide('TYPE_2', top.similarity, ids, lowVolume, {
      step: 'semantic_match',
      detail: {
        topSimilarity: top.similarity,
        threshold: engineConfig.semanticThreshold,
        matchedProduct: top.title,
      },
    });
  }

  // Step 7 — Product Gap.
  const bestSim = top?.similarity ?? 0;
  return decide('TYPE_1', clamp01(1 - bestSim), [], lowVolume, {
    step: 'product_gap',
    detail: {
      topSemanticSimilarity: bestSim,
      threshold: engineConfig.semanticThreshold,
    },
  });
}

/* ------------------------------------------------------------------ *
 * Helpers                                                             *
 * ------------------------------------------------------------------ */

interface CorpusEntry {
  id: string;
  haystack: string;
  kind: 'title' | 'tag';
}

interface CatalogIndex {
  /** Per-product normalized title + tags, for the exact/substring pass. */
  normalized: Array<{ product: ProductRef; title: string; tags: string[] }>;
  /** Flat title+tag corpus. Fuzzy scoring runs over a subset of this. */
  corpus: CorpusEntry[];
  /** Every distinct whitespace token across all haystacks. */
  vocab: string[];
  /** token -> indices into `corpus`. Drives candidate prefiltering. */
  tokenToEntries: Map<string, number[]>;
}

/**
 * Catalog index cache, keyed on the products ARRAY IDENTITY.
 *
 * Both passes below used to re-derive everything per query: findExactMatch
 * called normalizeQuery on every title and tag, and fuzzyMatch rebuilt the
 * entire corpus and constructed a fresh Fuse index. Classification runs one
 * query at a time against the same catalog, so at the acceptance target of
 * 10k queries x 5k products that is ~50M normalize calls and 10k full Fuse
 * builds over ~15k documents — quadratic work that pushed a 30s budget past
 * 28 MINUTES. Catalog-derived work now happens once per batch.
 *
 * WeakMap so a catalog is released as soon as the caller drops the array, and
 * identity-keyed rather than content-hashed because callers materialize a
 * fresh array per batch. The one caveat: mutating a products array in place
 * after first use would serve a stale index — don't do that; build a new array.
 */
const catalogCache = new WeakMap<ProductRef[], CatalogIndex>();

function getCatalogIndex(products: ProductRef[]): CatalogIndex {
  const cached = catalogCache.get(products);
  if (cached) return cached;

  const normalized = products.map((product) => ({
    product,
    title: normalizeQuery(product.title),
    tags: product.tags.map((t) => normalizeQuery(t)),
  }));

  const corpus: CorpusEntry[] = [];
  for (const entry of normalized) {
    corpus.push({ id: entry.product.id, haystack: entry.title, kind: 'title' });
    for (const tag of entry.tags) {
      corpus.push({ id: entry.product.id, haystack: tag, kind: 'tag' });
    }
  }

  const vocabSet = new Set<string>();
  const tokenToEntries = new Map<string, number[]>();
  corpus.forEach((entry, idx) => {
    for (const token of entry.haystack.split(' ')) {
      if (!token) continue;
      vocabSet.add(token);
      const bucket = tokenToEntries.get(token);
      if (bucket) bucket.push(idx);
      else tokenToEntries.set(token, [idx]);
    }
  });

  const index: CatalogIndex = { normalized, corpus, vocab: [...vocabSet], tokenToEntries };
  catalogCache.set(products, index);
  return index;
}

/**
 * Corpus entries that could survive the word-overlap rule for `needle`: some
 * word of the needle (>= 3 chars) must appear as a substring of the haystack.
 * A needle word contains no spaces, so `haystack.includes(word)` holds exactly
 * when some TOKEN of the haystack contains it — which the token index answers
 * without touching the full corpus.
 *
 * A needle whose words are all shorter than 3 chars carries no usable signal;
 * the old overlap check waved those through, so every entry stays a candidate.
 */
function candidateIndices(index: CatalogIndex, needle: string): number[] {
  const words = needle.split(' ').filter((w) => w.length >= 3);
  if (words.length === 0) return index.corpus.map((_, i) => i);

  const out = new Set<number>();
  for (const word of words) {
    const exact = index.tokenToEntries.get(word);
    if (exact) for (const i of exact) out.add(i);
    // Tokens that merely CONTAIN the word ("widgets" for "widget"). Scanning
    // the vocabulary is far cheaper than scanning the corpus: the vocabulary
    // holds distinct tokens, the corpus repeats them once per product.
    for (const token of index.vocab) {
      if (token.length > word.length && token.includes(word)) {
        const bucket = index.tokenToEntries.get(token);
        if (bucket) for (const i of bucket) out.add(i);
      }
    }
  }
  return [...out];
}

function findExactMatch(qNorm: string, products: ProductRef[]): ProductRef | null {
  if (!qNorm) return null;
  for (const entry of getCatalogIndex(products).normalized) {
    if (entry.title.includes(qNorm)) return entry.product;
    for (const tag of entry.tags) {
      if (tag === qNorm) return entry.product;
    }
  }
  return null;
}

interface FuzzyHit {
  score: number;
  topIds: string[];
  matchedTerm: string;
  expandedQueries: string[];
}

function fuzzyMatch(qNorm: string, products: ProductRef[]): FuzzyHit | null {
  if (!qNorm) return null;
  const index = getCatalogIndex(products);
  const expanded = expandSynonyms(qNorm);
  let best: { score: number; id: string; haystack: string; needle: string } | null = null;
  const idToScore = new Map<string, number>();

  for (const needle of expanded) {
    // Prefilter to entries that can satisfy the word-overlap rule, then score
    // only those. Fuse's cost scales with the number of MATCHES it returns, and
    // at threshold 0.35 the full 15k-entry corpus returned ~1,900 loose matches
    // per query, nearly all of which the overlap rule then discarded. Scoring
    // the candidate subset instead is ~9x faster, and a needle with no
    // candidates skips Fuse entirely rather than scoring the whole catalog just
    // to conclude nothing.
    const candidates = candidateIndices(index, needle);
    if (candidates.length === 0) continue;
    const fuse = new Fuse(
      candidates.map((i) => index.corpus[i] as CorpusEntry),
      FUSE_OPTIONS,
    );
    const results = fuse.search(needle);
    for (const r of results) {
      const score = r.score ?? 1;
      if (score <= engineConfig.fuzzyThreshold) {
        const current = idToScore.get(r.item.id);
        if (current === undefined || score < current) {
          idToScore.set(r.item.id, score);
        }
        if (!best || score < best.score) {
          best = { score, id: r.item.id, haystack: r.item.haystack, needle };
        }
      }
    }
  }

  if (!best) return null;

  // The word-overlap rule that used to run here — rejecting Fuse bitap false
  // positives such as "air conditioner" matching "inventory not tracked
  // snowboard" purely through shared characters — is now structural:
  // candidateIndices only admits entries that satisfy it, so everything scored
  // passes by construction.
  //
  // This deliberately changes one behaviour. Previously the GLOBAL best-scoring
  // entry was tested, and failing it discarded the whole match even when a
  // slightly worse entry did overlap — reporting a missing product (TYPE_1)
  // where a keyword fix (TYPE_2) existed. Now the best OVERLAPPING entry wins.

  const topIds = Array.from(idToScore.entries())
    .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([id]) => id);

  return {
    score: best.score,
    topIds,
    matchedTerm: best.haystack,
    expandedQueries: expanded,
  };
}

function decide(
  type: ClassificationType | 'NONE',
  confidence: number,
  matchedProductIds: string[],
  lowVolume: boolean,
  reasoning: ClassificationDecision['reasoning'],
): ClassificationDecision {
  return {
    type,
    confidence: clamp01(confidence),
    matchedProductIds,
    lowVolume,
    reasoning,
  };
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

/**
 * Returns true if at least one word from `needle` (≥3 chars) appears as a
 * substring in `haystack`. Prevents Fuse's character-level algorithm from
 * producing matches with zero semantic overlap (e.g. "air conditioner" → "snowboard").
 */
