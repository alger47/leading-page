/**
 * brief-analysis: extracting the engine's `has_enough_facts` signal from job
 * events (payload is relayed as the `detail` of `stage.brief_analyzed`).
 */
import { describe, expect, it } from 'vitest';
import { extractBriefAnalysis, extractGenerationMode, isIncompleteBrief } from '../lib/brief-analysis.js';

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

describe('extractGenerationMode', () => {
  it('reads the mode relayed on job.completed', () => {
    const events = [{ type: 'job.completed', at: 'x', detail: JSON.stringify({ mode: 'stub' }) }];
    expect(extractGenerationMode(events)).toBe('stub');
  });

  it('returns llm only for a real provider', () => {
    const events = [{ type: 'job.completed', at: 'x', detail: JSON.stringify({ mode: 'llm' }) }];
    expect(extractGenerationMode(events)).toBe('llm');
  });

  it('returns null when missing, malformed, or foreign', () => {
    expect(extractGenerationMode([])).toBeNull();
    expect(extractGenerationMode([{ type: 'job.completed', at: 'x' }])).toBeNull();
    expect(extractGenerationMode([{ type: 'job.completed', at: 'x', detail: 'not json' }])).toBeNull();
    expect(extractGenerationMode([{ type: 'job.completed', at: 'x', detail: '{}' }])).toBeNull();
    expect(extractGenerationMode(undefined)).toBeNull();
  });

  it('ignores mode on non-completed events', () => {
    const events = [{ type: 'stage.brief_analyzed', at: 'x', detail: JSON.stringify({ mode: 'llm' }) }];
    expect(extractGenerationMode(events)).toBeNull();
  });
});