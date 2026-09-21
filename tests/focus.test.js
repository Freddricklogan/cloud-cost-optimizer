import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseFocusCsv, splitCsvLine } from '../src/focus.js';

const sample = readFileSync(new URL('../data/focus-sample.csv', import.meta.url), 'utf8');
const HEAD = 'ChargePeriodStart,ProviderName,ServiceCategory,ServiceName,ResourceId,BilledCost,x_UtilizationPct,Tags,ListCost';

describe('splitCsvLine', () => {
  it('handles quoted commas and doubled quotes', () => {
    expect(splitCsvLine('a,"b,c","say ""hi""",d')).toEqual(['a', 'b,c', 'say "hi"', 'd']);
  });
});

describe('parseFocusCsv', () => {
  it('parses the shipped sample: 5673 rows, 31 resources, 3 providers, 183 days, no warnings', () => {
    const { rows, warnings, columns } = parseFocusCsv(sample);
    expect(rows).toHaveLength(5673);
    expect(warnings).toEqual([]);
    expect(new Set(rows.map((r) => r.resourceId)).size).toBe(31);
    expect(new Set(rows.map((r) => r.provider))).toEqual(new Set(['AWS', 'Azure', 'GCP']));
    expect(new Set(rows.map((r) => r.day)).size).toBe(183);
    expect(rows[0].tags).toEqual({ env: 'prod', team: 'api' });
    expect(columns).toContain('x_UtilizationPct');
  });
  it('rejects files without the required FOCUS columns', () => {
    expect(() => parseFocusCsv('name,cost\nx,1')).toThrow(/missing columns: ChargePeriodStart/);
    expect(() => parseFocusCsv('')).toThrow(/empty/);
    expect(() => parseFocusCsv(`${HEAD}\nnot-a-date,AWS,Compute,EC2,i-1,5,,,`)).toThrow(/no valid rows/);
  });
  it('drops bad rows with a warning and keeps the rest', () => {
    const text = [HEAD,
      '2026-09-01T00:00:00Z,AWS,Compute,EC2,i-1,5.5,42,"{""env"":""prod""}",6',
      '2026-09-01T00:00:00Z,AWS,Compute,EC2,i-2,-1,42,,',
      '2026-09-01T00:00:00Z,AWS,Compute,EC2,i-3,1,140,,',
      '2026-09-01T00:00:00Z,AWS,Compute,EC2,,1,10,,',
      '2026-09-01T00:00:00Z,AWS,Compute,EC2,i-5,2,,not json,'].join('\n');
    const { rows, warnings } = parseFocusCsv(text);
    expect(rows.map((r) => r.resourceId)).toEqual(['i-1', 'i-5']);
    expect(rows[0]).toMatchObject({ day: '2026-09-01', billedCost: 5.5, listCost: 6, utilization: 42, tags: { env: 'prod' }, pricing: 'On-Demand', currency: 'USD' });
    expect(rows[1]).toMatchObject({ listCost: 2, utilization: null, tags: {} });
    expect(warnings).toEqual(['row 3: BilledCost must be a non-negative number', 'row 4: x_UtilizationPct out of range', 'row 5: empty ResourceId']);
  });
  it('warns on mixed currencies', () => {
    const text = `${HEAD},BillingCurrency\n2026-09-01T00:00:00Z,AWS,Compute,EC2,i-1,1,,,,USD\n2026-09-01T00:00:00Z,AWS,Compute,EC2,i-2,1,,,,EUR`;
    expect(parseFocusCsv(text).warnings[0]).toMatch(/mixed currencies/);
  });
});
