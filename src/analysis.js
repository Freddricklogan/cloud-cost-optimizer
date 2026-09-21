/** Cost analytics over parsed FOCUS rows: totals, trends, forecast, anomalies, idle detection. All values are computed from the rows. */

const sum = (xs) => xs.reduce((a, b) => a + b, 0);
export const monthOf = (day) => day.slice(0, 7);

export function totals(rows) {
  return { billed: sum(rows.map((r) => r.billedCost)), list: sum(rows.map((r) => r.listCost)) };
}

export function groupSum(rows, key) {
  const m = new Map();
  for (const r of rows) m.set(r[key], (m.get(r[key]) ?? 0) + r.billedCost);
  return [...m.entries()].map(([label, billed]) => ({ label, billed })).sort((a, b) => b.billed - a.billed);
}

/** Daily billed totals as a sorted array of { day, billed }. */
export function dailySeries(rows) {
  const m = new Map();
  for (const r of rows) m.set(r.day, (m.get(r.day) ?? 0) + r.billedCost);
  return [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([day, billed]) => ({ day, billed }));
}

/** Monthly totals with the number of days present; the last month may be partial. */
export function monthlySeries(rows) {
  const m = new Map();
  for (const r of rows) {
    const k = monthOf(r.day);
    const e = m.get(k) ?? { month: k, billed: 0, days: new Set() };
    e.billed += r.billedCost;
    e.days.add(r.day);
    m.set(k, e);
  }
  return [...m.values()].sort((a, b) => (a.month < b.month ? -1 : 1)).map((e) => ({ month: e.month, billed: e.billed, days: e.days.size }));
}

function daysInMonth(month) {
  const [y, mo] = month.split('-').map(Number);
  return new Date(Date.UTC(y, mo, 0)).getUTCDate();
}

/** Ordinary least squares y = a + b·x over (x, y) pairs. */
export function linearFit(points) {
  const n = points.length;
  if (n < 2) return { a: points[0]?.[1] ?? 0, b: 0 };
  const mx = sum(points.map((p) => p[0])) / n;
  const my = sum(points.map((p) => p[1])) / n;
  const sxx = sum(points.map((p) => (p[0] - mx) ** 2));
  const b = sxx === 0 ? 0 : sum(points.map((p) => (p[0] - mx) * (p[1] - my))) / sxx;
  return { a: my - b * mx, b };
}

/**
 * Month-to-date spend and a projected month-end total: a linear trend fitted to the last
 * `window` days of daily spend, extrapolated across the remaining days of the month.
 */
export function forecastMonth(rows, { window = 28 } = {}) {
  const daily = dailySeries(rows);
  if (daily.length === 0) return null;
  const lastDay = daily[daily.length - 1].day;
  const month = monthOf(lastDay);
  const mtdRows = daily.filter((d) => monthOf(d.day) === month);
  const mtd = sum(mtdRows.map((d) => d.billed));
  const elapsed = Number(lastDay.slice(8, 10));
  const total = daysInMonth(month);
  const recent = daily.slice(-window);
  const fit = linearFit(recent.map((d, i) => [i, d.billed]));
  let projectedRemaining = 0;
  for (let k = 1; k <= total - elapsed; k += 1) projectedRemaining += Math.max(0, fit.a + fit.b * (recent.length - 1 + k));
  const prevMonth = monthlySeries(rows).filter((m) => m.month < month).pop() ?? null;
  return { month, elapsedDays: elapsed, daysInMonth: total, monthToDate: mtd, projected: mtd + projectedRemaining, dailySlope: fit.b, previousMonth: prevMonth };
}

/** Month-over-month change for the two most recent complete months, or null if not available. */
export function monthOverMonth(rows) {
  const months = monthlySeries(rows).filter((m) => m.days >= daysInMonth(m.month));
  if (months.length < 2) return null;
  const [prev, last] = months.slice(-2);
  return { from: prev.month, to: last.month, previous: prev.billed, latest: last.billed, changePct: prev.billed === 0 ? null : ((last.billed - prev.billed) / prev.billed) * 100 };
}

/**
 * Anomalous days per service: daily spend more than `z` standard deviations above the trailing
 * `window`-day mean (both computed from the days before the one being tested).
 */
export function anomalies(rows, { window = 30, z = 3, minUsd = 20 } = {}) {
  const byService = new Map();
  for (const r of rows) {
    const key = `${r.provider} · ${r.service}`;
    const m = byService.get(key) ?? new Map();
    m.set(r.day, (m.get(r.day) ?? 0) + r.billedCost);
    byService.set(key, m);
  }
  const out = [];
  for (const [service, m] of byService) {
    const days = [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
    for (let i = window; i < days.length; i += 1) {
      const trailing = days.slice(i - window, i).map((d) => d[1]);
      const mean = sum(trailing) / window;
      const sd = Math.sqrt(sum(trailing.map((v) => (v - mean) ** 2)) / window);
      const [day, value] = days[i];
      const excess = value - mean;
      if (sd > 0 && excess / sd > z && excess >= minUsd) out.push({ service, day, value, expected: mean, excess, zScore: excess / sd });
      else if (sd === 0 && excess >= minUsd && mean > 0) out.push({ service, day, value, expected: mean, excess, zScore: Infinity });
    }
  }
  return out.sort((a, b) => b.excess - a.excess);
}

/** Per-resource summary over the period: cost, mean utilisation over the last `window` days, pricing mix. */
export function resourceSummary(rows, { window = 14 } = {}) {
  const days = [...new Set(rows.map((r) => r.day))].sort();
  const recent = new Set(days.slice(-window));
  const m = new Map();
  for (const r of rows) {
    const e = m.get(r.resourceId) ?? { resourceId: r.resourceId, name: r.resourceName, provider: r.provider, category: r.category, service: r.service, type: r.resourceType, region: r.region, pricing: r.pricing, tags: r.tags, billed: 0, list: 0, recentBilled: 0, recentDays: 0, utilSum: 0, utilN: 0 };
    e.billed += r.billedCost;
    e.list += r.listCost;
    if (recent.has(r.day)) {
      e.recentBilled += r.billedCost;
      e.recentDays += 1;
      if (r.utilization !== null) {
        e.utilSum += r.utilization;
        e.utilN += 1;
      }
    }
    m.set(r.resourceId, e);
  }
  return [...m.values()].map((e) => ({ ...e, dailyRun: e.recentDays ? e.recentBilled / e.recentDays : 0, monthlyRun: e.recentDays ? (e.recentBilled / e.recentDays) * 30 : 0, utilization: e.utilN ? e.utilSum / e.utilN : null })).sort((a, b) => b.monthlyRun - a.monthlyRun);
}

/** Simple percentile on an unsorted array (linear interpolation). */
export function percentile(values, p) {
  const s = [...values].sort((a, b) => a - b);
  if (s.length === 0) return NaN;
  const i = (s.length - 1) * p;
  const lo = Math.floor(i);
  return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (i - lo);
}
