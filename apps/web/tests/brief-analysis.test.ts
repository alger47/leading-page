/**
 * brief-analysis: extracting the engine's `has_enough_facts` signal from job
 * events (payload is relayed as the `detail` of `stage.brief_analyzed`).
 */
import { describe, expect, it } from 'vitest';
import { extractBriefAnalysis, isIncompleteBrief } from '../lib/brief-analysis.js';

describe('extractBriefAnalysis', () => {
  it('parses the brief-analyzed event detail', () => {
    const events = [
      { type: 'stage.brief_analyzed', at: '2026-09-10T00:00:00.000Z', detail: JSON.stringify({ vertical: 'other', tone: 'warm-professional', has_enough_facts: false }) },
    ];
    expect(extractBriefAnalysis(events)?.has_enough_facts).toBe(false);
    expect(extractBriefAnalysis(events)?.vertical).toBe('other');
  });

  it('returns null when no analyzed event or no detail', () => {
    expect(extractBriefAnalysis([])).toBeNull();
    expect(extractBriefAnalysis([{ type: 'stage.brief_analyzed', at: 'x' }])).toBeNull();
    expect(extractBriefAnalysis(undefined)).toBeNull();
    expect(extractBriefAnalysis(null)).toBeNull();
  });

  it('ignores malformed detail payloads', () => {
    const events = [{ type: 'stage.brief_analyzed', at: 'x', detail: 'not json' }];
    expect(extractBriefAnalysis(events)).toBeNull();
  });

  it('picks a later well-formed event', () => {
    const events = [
      { type: 'stage.brief_analyzed', at: 'a', detail: 'bad' },
      { type: 'stage.brief_analyzed', at: 'b', detail: JSON.stringify({ has_enough_facts: true }) },
    ];
    expect(extractBriefAnalysis(events)?.has_enough_facts).toBe(true);
  });
});

describe('isIncompleteBrief', () => {
  it('is true only when the analysis explicitly flags it', () => {
    const thin = [{ type: 'stage.brief_analyzed', at: 'x', detail: JSON.stringify({ has_enough_facts: false }) }];
    const rich = [{ type: 'stage.brief_analyzed', at: 'x', detail: JSON.stringify({ has_enough_facts: true }) }];
    expect(isIncompleteBrief(thin)).toBe(true);
    expect(isIncompleteBrief(rich)).toBe(false);
    expect(isIncompleteBrief([])).toBe(false);
  });
});