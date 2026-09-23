/**
 * The models.py conventions, asserted rather than trusted:
 * absent means empty string, nothing is nullable, everything has a default,
 * and the JSON Schema comes out in strict mode.
 */

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  AtsReportSchema,
  GapAnalysisSchema,
  JobSpecSchema,
  ResumeFactsSchema,
  SourceDocumentSchema,
  StrategySchema,
  StyleProfileSchema,
  SubScoresSchema,
  TailoredResumeSchema,
  TruthReportSchema,
  TruthViolationSchema,
  allLines,
  allTerms,
  toJsonSchema,
  type JobSpec,
} from '../src/schema/index.js';

const ALL = {
  ResumeFacts: ResumeFactsSchema,
  JobSpec: JobSpecSchema,
  TailoredResume: TailoredResumeSchema,
  AtsReport: AtsReportSchema,
  SubScores: SubScoresSchema,
  TruthReport: TruthReportSchema,
  TruthViolation: TruthViolationSchema,
  GapAnalysis: GapAnalysisSchema,
  Strategy: StrategySchema,
  StyleProfile: StyleProfileSchema,
  SourceDocument: SourceDocumentSchema,
} as const;

describe('the models.py conventions', () => {
  it.each(Object.entries(ALL))('%s parses an empty object into a full one', (_name, schema) => {
    const parsed = (schema as z.ZodTypeAny).parse({});
    expect(parsed).toBeTypeOf('object');
    expect(parsed).not.toBeNull();
  });

  it('defaults absent strings to "" rather than null or undefined', () => {
    const job = JobSpecSchema.parse({});
    expect(job.company).toBe('');
    expect(job.location).toBe('');
    expect(job.extraction_notes).toBe('');
    expect(job.experience_years).toEqual({ min: 0, max: 0, raw: '' });
    expect(job.keywords).toEqual([]);
  });

  it('rejects null where models.py would have no nullable union', () => {
    expect(() => JobSpecSchema.parse({ company: null })).toThrow();
    expect(() => TailoredResumeSchema.parse({ headline: null })).toThrow();
  });

  it('keeps the one nullable models.py actually declares', () => {
    expect(SourceDocumentSchema.parse({}).style).toBeNull();
    expect(SourceDocumentSchema.parse({ style: null }).style).toBeNull();
  });

  it('defaults enums the way models.py does', () => {
    const job = JobSpecSchema.parse({});
    expect(job.work_mode).toBe('unspecified');
    expect(job.extraction_confidence).toBe('high');
    expect(TruthViolationSchema.parse({}).severity).toBe('error');
    expect(StyleProfileSchema.parse({}).bullet_glyph).toBe('•');
    expect(SubScoresSchema.parse({}).relevance_gate).toBe(1);
  });
});

describe('the model methods', () => {
  it('allTerms lists requirements, keywords and variants', () => {
    const job: JobSpec = JobSpecSchema.parse({
      requirements: [{ term: 'Node.js', category: 'framework', importance: 'required', evidence: 'x' }],
      keywords: [{ term: 'PostgreSQL', variants: ['Postgres'], weight: 5 }],
    });
    expect(allTerms(job)).toEqual(['Node.js', 'PostgreSQL', 'Postgres']);
  });

  it('allLines labels every rewritten line', () => {
    const doc = TailoredResumeSchema.parse({
      summary: { text: 'Ships services.', source_ids: ['SUMMARY'] },
      skills: [{ category: 'Backend', items: ['Node.js', 'Redis'], source_ids: ['S1'] }],
      experience: [
        {
          source_id: 'E1',
          company: 'Acme',
          title: 'Engineer',
          start_date: 'Jun 2023',
          end_date: 'Present',
          bullets: [{ text: 'Indexed it.', source_ids: ['E1.B1'], keywords: [] }],
        },
      ],
    });
    expect(allLines(doc)).toEqual([
      ['Summary', 'Ships services.', ['SUMMARY']],
      ['Skills / Backend', 'Node.js, Redis', ['S1']],
      ['Experience / Acme / bullet 1', 'Indexed it.', ['E1.B1']],
    ]);
  });
});

describe('toJsonSchema', () => {
  function everyObjectNode(node: unknown, visit: (o: Record<string, unknown>) => void): void {
    if (Array.isArray(node)) {
      for (const item of node) everyObjectNode(item, visit);
      return;
    }
    if (node !== null && typeof node === 'object') {
      const obj = node as Record<string, unknown>;
      if (obj['type'] === 'object' && 'properties' in obj) visit(obj);
      for (const value of Object.values(obj)) everyObjectNode(value, visit);
    }
  }

  it.each(Object.entries(ALL))(
    '%s: every object is closed and every property required',
    (_name, schema) => {
      const json = toJsonSchema(schema as z.ZodTypeAny);
      let seen = 0;
      everyObjectNode(json, (obj) => {
        seen += 1;
        expect(obj['additionalProperties']).toBe(false);
        expect(obj['required']).toEqual(Object.keys(obj['properties'] as object));
      });
      expect(seen).toBeGreaterThan(0);
    },
  );

  it('emits the right primitive types', () => {
    const json = toJsonSchema(JobSpecSchema, 'JobSpec') as Record<string, unknown>;
    const props = json['properties'] as Record<string, Record<string, unknown>>;
    expect(json['title']).toBe('JobSpec');
    expect(props['company']!['type']).toBe('string');
    expect(props['responsibilities']!['type']).toBe('array');
    expect(props['work_mode']!['enum']).toEqual(['onsite', 'hybrid', 'remote', 'unspecified']);
    const keywords = props['keywords']!['items'] as Record<string, unknown>;
    const kwProps = keywords['properties'] as Record<string, Record<string, unknown>>;
    expect(kwProps['weight']!['type']).toBe('integer');
  });

  it('keeps defaults as documentation without making the key optional', () => {
    const json = toJsonSchema(JobSpecSchema) as Record<string, unknown>;
    const props = json['properties'] as Record<string, Record<string, unknown>>;
    expect(props['location']!['default']).toBe('');
    expect(json['required']).toContain('location');
  });

  it('renders the one nullable field as a type union', () => {
    const json = toJsonSchema(SourceDocumentSchema) as Record<string, unknown>;
    const props = json['properties'] as Record<string, Record<string, unknown>>;
    expect(props['style']!['type']).toEqual(['object', 'null']);
  });

  it('throws rather than quietly emitting a permissive schema', () => {
    expect(() => toJsonSchema(z.map(z.string(), z.string()))).toThrow(/unsupported Zod node/);
  });
});
