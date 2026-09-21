import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { resourceSummary } from '../src/analysis.js';
import { parseFocusCsv } from '../src/focus.js';
import { DEFAULT_ASSUMPTIONS, recommend, recommendationsCsv, stepDown } from '../src/recommend.js';

const { rows } = parseFocusCsv(readFileSync(new URL('../data/focus-sample.csv', import.meta.url), 'utf8'));
const summary = resourceSummary(rows);

describe('stepDown', () => {
  it('knows AWS, Azure and GCP naming and refuses the smallest sizes', () => {
    expect(stepDown('m5.2xlarge')).toBe('m5.xlarge');
    expect(stepDown('db.r5.xlarge')).toBe('db.r5.large');
    expect(stepDown('cache.r6g.xlarge')).toBe('cache.r6g.large');
    expect(stepDown('t3.nano')).toBeNull();
    expect(stepDown('Standard_D8s_v3')).toBe('Standard_D4s_v3');
    expect(stepDown('Standard_B4ms')).toBeNull();
    expect(stepDown('n2-standard-8')).toBe('n2-standard-4');
    expect(stepDown('db-custom-8-32768')).toBe('db-custom-4-16384');
    expect(stepDown('BC_Gen5_8')).toBeNull();
    expect(stepDown('')).toBeNull();
  });
});

describe('recommend', () => {
  const items = recommend(summary, rows);
  it('finds the idle dev and staging fleets and prices them at run rate', () => {
    const idle = items.filter((i) => i.kind === 'idle');
    expect(idle.map((i) => i.resource.resourceId).sort()).toEqual(['gce-dev', 'i-0c3staging', 'i-0d4dev', 'vm-staging']);
    for (const i of idle) expect(i.monthlySaving).toBeCloseTo(i.resource.monthlyRun, 6);
  });
  it('right-sizes only when a step down keeps utilisation under target and a smaller size exists', () => {
    const rs = items.filter((i) => i.kind === 'rightsize');
    for (const i of rs) {
      expect(i.resource.utilization / DEFAULT_ASSUMPTIONS.stepDownRatio).toBeLessThanOrEqual(DEFAULT_ASSUMPTIONS.targetUtilPct);
      expect(i.monthlySaving).toBeCloseTo(i.resource.monthlyRun * 0.5, 6);
    }
    expect(rs.map((i) => i.resource.resourceId)).toContain('db-analytics');
    expect(rs.map((i) => i.resource.resourceId)).not.toContain('i-0d4dev'); // idle, not right-size
  });
  it('recommends commitments only for on-demand, steady resources, with both terms priced', () => {
    const c = items.filter((i) => i.kind === 'commit');
    expect(c.map((i) => i.resource.resourceId)).not.toContain('i-0a1prodapi'); // already committed
    expect(c.map((i) => i.resource.resourceId)).toContain('db-prod-primary');
    for (const i of c) {
      expect(i.resource.pricing).toBe('On-Demand');
      expect(i.resource.utilization).toBeGreaterThanOrEqual(50);
      expect(i.monthlySaving3y).toBeGreaterThan(i.monthlySaving);
    }
  });
  it('reports the egress step-change as a high-priority observation with no saving claimed', () => {
    const n = items.find((i) => i.kind === 'network');
    expect(n.priority).toBe('high');
    expect(n.monthlySaving).toBe(0);
    expect(n.detail).toMatch(/% of the last 30 days/);
  });
  it('lists anomalies with zero recurring saving and sorts by saving', () => {
    expect(items.filter((i) => i.kind === 'anomaly').length).toBeGreaterThan(0);
    for (let i = 1; i < items.length; i += 1) expect(items[i - 1].monthlySaving).toBeGreaterThanOrEqual(items[i].monthlySaving);
  });
  it('honours edited assumptions', () => {
    const strict = recommend(summary, rows, { ...DEFAULT_ASSUMPTIONS, idleUtilPct: 5, commit1yDiscount: 0.1, commit3yDiscount: 0.2 });
    expect(strict.filter((i) => i.kind === 'idle')).toEqual([]);
    expect(strict.find((i) => i.kind === 'commit').basis).toMatch(/10% \(1-year\) \/ 20% \(3-year\)/);
  });
  it('exports CSV with quoted fields', () => {
    const csv = recommendationsCsv(items.slice(0, 2));
    expect(csv.split('\n')[0]).toBe('kind,priority,resource_id,title,detail,monthly_saving_usd,monthly_saving_3y_usd,basis');
    expect(csv.split('\n')).toHaveLength(4);
    expect(csv).toMatch(/"idle","high"/);
  });
});
