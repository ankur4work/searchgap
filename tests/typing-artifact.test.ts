import { describe, it, expect } from 'vitest';
import { isTypingArtifact } from '@/lib/ingestion/normalize';

/**
 * Guards the rule that decides whether a shopper's previous search was an
 * unfinished keystroke or a deliberate query.
 *
 * This matters more than most predicates in the codebase: a `true` here DELETES
 * the earlier search row, and — if nothing else references that query — its
 * classification and revenue estimate too. The permissive version of this rule
 * (a bare `startsWith` over a 60-second window) is what made the app report
 * "Searches tracked: 1" to a Shopify reviewer who had searched several related
 * terms in a row, and is the reason the app was rejected under 2.1.4.
 *
 * The bias is therefore explicit: when in doubt, keep the data.
 */
describe('isTypingArtifact', () => {
  describe('mid-word continuations are artifacts', () => {
    it.each([
      ['the reported case', 'test pr', 'test products'],
      ['single word being typed', 'shir', 'shirt'],
      ['one more character', 'shirtt', 'shirttt'],
      ['long pause mid-word', 'sneak', 'sneakers'],
      ['second word being typed', 'blue shi', 'blue shirt'],
      ['third word being typed', 'red cotton tshir', 'red cotton tshirt'],
    ])('%s: %j → %j', (_label, prev, next) => {
      expect(isTypingArtifact(prev, next)).toBe(true);
    });
  });

  describe('deliberate refinements are NOT artifacts', () => {
    it.each([
      ['adds a new word', 'shirt', 'shirt blue'],
      ['adds two words', 'shirt', 'shirt blue xl'],
      ['refines an already-refined query', 'shirt blue', 'shirt blue xl'],
      ['prev ends in a space', 'shirt ', 'shirt blue'],
      ['single char then a word', 'a', 'a shirt'],
    ])('%s: %j → %j', (_label, prev, next) => {
      expect(isTypingArtifact(prev, next)).toBe(false);
    });
  });

  describe('unrelated queries are never artifacts', () => {
    it.each([
      ['completely different', 'shirt', 'trousers'],
      ['shares a prefix but diverges', 'shirt', 'shine'],
      ['next is SHORTER (backspacing)', 'shirt blue', 'shirt'],
      ['identical', 'shirt', 'shirt'],
      ['empty previous', '', 'shirt'],
      ['empty next', 'shirt', ''],
      ['both empty', '', ''],
    ])('%s: %j → %j', (_label, prev, next) => {
      expect(isTypingArtifact(prev, next)).toBe(false);
    });
  });

  it('never treats a query as an artifact of itself', () => {
    for (const q of ['shirt', 'blue shirt', 'a', '']) {
      expect(isTypingArtifact(q, q)).toBe(false);
    }
  });

  it('is not symmetric — only forward typing collapses', () => {
    expect(isTypingArtifact('test pr', 'test products')).toBe(true);
    expect(isTypingArtifact('test products', 'test pr')).toBe(false);
  });
});
