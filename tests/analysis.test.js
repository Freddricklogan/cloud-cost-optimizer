import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { anomalies, dailySeries, forecastMonth, groupSum, linearFit, monthOverMonth, monthlySeries, percentile, resourceSummary, totals } from '../src/analysis.js';
import { parseFocusCsv } from '../src/focus.js';

const { rows } = parseFocusCsv(readFileSync(new URL('../data/focus-sample.csv', import.meta.url), 'utf8'));
const row = (day, billed, extra = {}) => ({ day, provider: 'AWS', category: 'Compute', service: 'EC2', resourceId: 'i-1', resourceName: 'x', resourceType: 'm5.xlarge', region: 'r', pricing: 'On-Demand', listCost: billed, billedCost: billed, utilization: null, tags: {}, ...extra });

describe('aggregations', () => {
  it('totals and groups reconcile to the same sum', () => {
    const t = totals(rows);
    const byProv = groupSum(rows, 'provider');
    expect(byProv.reduce((s, g) => s + g.billed, 0)).toBeCloseTo(t.billed, 6);
    expect(groupSum(rows, 'service').reduce((s, g) => s + g.billed, 0)).toBeCloseTo(t.billed, 6);
    expect(dailySeries(rows).reduce((s, d) => s + d.billed, 0)).toBeCloseTo(t.billed, 6);
    expect(t.list).toBeGreaterThan(t.billed); // committed rows are billed below list
    expect(byProv[0].billed).toBeGreaterThanOrEqual(byProv[1].billed);
  });
  it('monthly series marks partial months by day count', () => {
    const m = monthlySeries(rows);
    expect(m[0]).toMatchObject({ month: '2026-03', days: 10 });
    expect(m.at(-1)).toMatchObject({ month: '2026-09', days: 20 });
    expect(m.find((x) => x.month === '2026-04').days).toBe(30);
  });
});

describe('forecast and month-over-month', () => {
  it('fits a line exactly to linear data', () => {
    expect(linearFit([[0, 1], [1, 3], [2, 5]])).toEqual({ a: 1, b: 2 });
    expect(linearFit([[1, 5]])).toEqual({ a: 5, b: 0 });
    expect(linearFit([[2, 1], [2, 3]]).b).toBe(0);
  });
  it('projects a flat series to elapsed-days scaling', () => {
    const flat = Array.from({ length: 40 }, (_, i) => row(new Date(Date.UTC(2026, 7, 1 + i)).toISOString().slice(0, 10), 100));
    const f = forecastMonth(flat);
    expect(f).toMatchObject({ month: '2026-09', elapsedDays: 9, daysInMonth: 30, monthToDate: 900 });
    expect(f.projected).toBeCloseTo(3000, 6);
    expect(f.previousMonth).toMatchObject({ month: '2026-08', billed: 3100 });
    expect(forecastMonth([])).toBeNull();
  });
  it('sample: September projection exceeds month-to-date and MoM compares complete months only', () => {
    const f = forecastMonth(rows);
    expect(f.month).toBe('2026-09');
    expect(f.projected).toBeGreaterThan(f.monthToDate);
    const mom = monthOverMonth(rows);
    expect(mom).toMatchObject({ from: '2026-07', to: '2026-08' });
    expect(mom.changePct).toBeGreaterThan(0);
    expect(monthOverMonth(rows.filter((r) => r.day >= '2026-09-01'))).toBeNull();
  });
});

describe('anomalies', () => {
  it('flags the injected BigQuery and Lambda spikes and nothing on flat data', () => {
    const found = anomalies(rows);
    expect(found.map((a) => a.service)).toContain('GCP · BigQuery');
    expect(found.map((a) => a.service)).toContain('AWS · AWS Lambda');
    expect(found[0].zScore).toBeGreaterThan(3);
    const flat = Array.from({ length: 60 }, (_, i) => row(new Date(Date.UTC(2026, 6, 1 + i)).toISOString().slice(0, 10), 50));
    expect(anomalies(flat)).toEqual([]);
    const step = flat.map((r, i) => (i === 59 ? { ...r, billedCost: 90 } : r));
    expect(anomalies(step)).toMatchObject([{ day: '2026-08-29', value: 90, expected: 50, zScore: Infinity }]);
  });
});

describe('resourceSummary and percentile', () => {
  it('computes run rate from the last 14 days and mean utilisation', () => {
    const s = resourceSummary(rows);
    expect(s).toHaveLength(31);
    const dev = s.find((r) => r.resourceId === 'i-0d4dev');
    expect(dev.utilization).toBeLessThan(20);
    expect(dev.recentDays).toBe(14);
    expect(dev.monthlyRun).toBeCloseTo((dev.recentBilled / 14) * 30, 6);
    expect(s.find((r) => r.resourceId === 's3-app-data').utilization).toBeNull();
    expect(s[0].monthlyRun).toBeGreaterThanOrEqual(s[1].monthlyRun);
  });
  it('percentile interpolates', () => {
    expect(percentile([3, 1, 2, 4], 0.5)).toBe(2.5);
    expect(percentile([], 0.5)).toBeNaN();
  });
});
