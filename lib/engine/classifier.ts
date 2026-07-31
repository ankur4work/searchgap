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
  /** Fuse index over titles + tags, for the fuzzy pass. */
  fuse: Fuse<CorpusEntry>;
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

  const index: CatalogIndex = { normalized, fuse: new Fuse(corpus, FUSE_OPTIONS) };
  catalogCache.set(products, index);
  return index;
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
  // Flat corpus of (productId, haystack) across titles + tags so a single Fuse
  // query scores against both. Built once per catalog — see getCatalogIndex.
  const { fuse } = getCatalogIndex(products);

  const expanded = expandSynonyms(qNorm);
  let best: { score: number; id: string; haystack: string; needle: string } | null = null;
  const idToScore = new Map<string, number>();

  for (const needle of expanded) {
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

  // Reject character-level false positives: at least one word (≥3 chars) from
  // the term that actually matched must appear as a substring in the matched
  // haystack. Without this guard, Fuse's bitap algorithm matches "air
  // conditioner" against "inventory not tracked snowboard" through shared
  // characters with no semantic overlap.
  //
  // This checks `best.needle`, NOT the raw query. Checking the query defeated
  // synonym expansion completely: a synonym is only useful when the shopper's
  // words DON'T appear in the title, so every synonym-only hit — "bandhgala"
  // against "Ethnic Nehru Jacket" — was thrown away here and misreported as a
  // missing product (TYPE_1) instead of a keyword fix (TYPE_2). When the hit
  // came from the query itself, needle === qNorm and behaviour is unchanged.
  if (!hasWordOverlap(best.needle, best.haystack)) return null;

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
function hasWordOverlap(needle: string, haystack: string): boolean {
  const words = needle.split(' ').filter((w) => w.length >= 3);
  if (words.length === 0) return true;
  return words.some((w) => haystack.includes(w));
}
