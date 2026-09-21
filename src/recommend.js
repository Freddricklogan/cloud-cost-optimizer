/**
 * Recommendations derived from the resource summary. Every saving is arithmetic on the observed
 * run rate and an explicit, user-editable assumption; the assumption used is attached to each item.
 */
import { anomalies, dailySeries } from './analysis.js';

export const DEFAULT_ASSUMPTIONS = {
  idleUtilPct: 20, // below this mean utilisation over the window a compute/database resource is "idle"
  targetUtilPct: 80, // after a one-step downsize, utilisation must stay at or below this
  commitMinUtilPct: 50, // steady enough to commit
  commit1yDiscount: 0.30, // assumption: fraction off on-demand for a 1-year commitment — edit to your provider's published rate
  commit3yDiscount: 0.50, // assumption: fraction off on-demand for a 3-year commitment — edit to your provider's published rate
  stepDownRatio: 0.5 // assumption: one size step down within a family halves the on-demand price (true for AWS/Azure/GCP general-purpose families)
};

const COMPUTE_LIKE = new Set(['Compute', 'Databases']);
const isSized = (r) => COMPUTE_LIKE.has(r.category) && r.utilization !== null;

/** Suggests the next size down for common naming schemes; returns null when no smaller size is known. */
export function stepDown(type) {
  const aws = type.match(/^((?:db\.|cache\.)?[a-z0-9]+)\.(\w+)$/);
  const ladder = ['nano', 'micro', 'small', 'medium', 'large', 'xlarge', '2xlarge', '4xlarge', '8xlarge', '12xlarge', '16xlarge', '24xlarge'];
  if (aws) {
    const i = ladder.indexOf(aws[2]);
    return i > 0 ? `${aws[1]}.${ladder[i - 1]}` : null;
  }
  const azure = type.match(/^(Standard_[A-Z]+)(\d+)([a-z]*_v\d)$/);
  if (azure) return Number(azure[2]) > 1 ? `${azure[1]}${Number(azure[2]) / 2}${azure[3]}` : null;
  const gcp = type.match(/^([a-z]\d-[a-z]+)-(\d+)$/);
  if (gcp) return Number(gcp[2]) > 1 ? `${gcp[1]}-${Number(gcp[2]) / 2}` : null;
  const gcpCustom = type.match(/^(db-custom)-(\d+)-(\d+)$/);
  if (gcpCustom) return Number(gcpCustom[2]) > 1 ? `${gcpCustom[1]}-${Number(gcpCustom[2]) / 2}-${Number(gcpCustom[3]) / 2}` : null;
  return null;
}

export function recommend(summary, rows, a = DEFAULT_ASSUMPTIONS) {
  const items = [];
  for (const r of summary.filter(isSized)) {
    if (r.utilization < a.idleUtilPct) {
      items.push({ kind: 'idle', priority: 'high', resource: r, title: `Stop or remove ${r.name}`, detail: `${r.utilization.toFixed(1)}% mean utilisation over the last 14 days (threshold ${a.idleUtilPct}%); ${r.type || r.service} in ${r.region}.`, monthlySaving: r.monthlyRun, basis: 'full monthly run rate if removed' });
    } else if (r.utilization * (1 / a.stepDownRatio) <= a.targetUtilPct && stepDown(r.type)) {
      items.push({ kind: 'rightsize', priority: 'medium', resource: r, title: `Right-size ${r.name}: ${r.type} → ${stepDown(r.type)}`, detail: `${r.utilization.toFixed(1)}% utilisation; one step down projects to ${(r.utilization / a.stepDownRatio).toFixed(0)}% (target ≤ ${a.targetUtilPct}%).`, monthlySaving: r.monthlyRun * (1 - a.stepDownRatio), basis: `assumes one step down costs ${(a.stepDownRatio * 100).toFixed(0)}% of the current size` });
    }
    if (r.pricing === 'On-Demand' && r.utilization >= a.commitMinUtilPct) {
      items.push({ kind: 'commit', priority: 'high', resource: r, title: `Commit ${r.name} (${r.type})`, detail: `${r.utilization.toFixed(1)}% steady utilisation on on-demand pricing.`, monthlySaving: r.monthlyRun * a.commit1yDiscount, monthlySaving3y: r.monthlyRun * a.commit3yDiscount, basis: `assumes ${(a.commit1yDiscount * 100).toFixed(0)}% (1-year) / ${(a.commit3yDiscount * 100).toFixed(0)}% (3-year) off on-demand — edit to your published rate` });
    }
  }
  const daily = dailySeries(rows);
  const last30 = daily.slice(-30);
  const prior30 = daily.slice(-60, -30);
  const netRows = rows.filter((r) => r.category === 'Networking');
  if (netRows.length && last30.length === 30 && prior30.length === 30) {
    const in30 = new Set(last30.map((d) => d.day));
    const inPrior = new Set(prior30.map((d) => d.day));
    const netLast = netRows.filter((r) => in30.has(r.day)).reduce((s, r) => s + r.billedCost, 0);
    const netPrior = netRows.filter((r) => inPrior.has(r.day)).reduce((s, r) => s + r.billedCost, 0);
    const totalLast = last30.reduce((s, d) => s + d.billed, 0);
    items.push({ kind: 'network', priority: netPrior > 0 && netLast / netPrior > 1.2 ? 'high' : 'low', resource: null, title: 'Review data transfer and egress', detail: `Networking was ${((netLast / totalLast) * 100).toFixed(1)}% of the last 30 days' spend ($${netLast.toFixed(0)}), ${netPrior > 0 ? `${netLast >= netPrior ? "+" : ""}${(((netLast - netPrior) / netPrior) * 100).toFixed(0)}% versus the prior 30 days` : 'no prior period to compare'}. No saving is claimed without a traffic breakdown.`, monthlySaving: 0, basis: 'observation only' });
  }
  for (const an of anomalies(rows).slice(0, 5)) {
    items.push({ kind: 'anomaly', priority: 'medium', resource: null, title: `Investigate ${an.service} on ${an.day}`, detail: `$${an.value.toFixed(0)} against a trailing 30-day mean of $${an.expected.toFixed(0)} (${Number.isFinite(an.zScore) ? `${an.zScore.toFixed(1)}σ` : 'flat baseline'}); one-off excess $${an.excess.toFixed(0)}.`, monthlySaving: 0, basis: 'one-off; not a recurring saving' });
  }
  return items.sort((x, y) => y.monthlySaving - x.monthlySaving || x.title.localeCompare(y.title));
}

export function recommendationsCsv(items) {
  const esc = (v) => `"${String(v ?? '').replaceAll('"', '""')}"`;
  const head = ['kind', 'priority', 'resource_id', 'title', 'detail', 'monthly_saving_usd', 'monthly_saving_3y_usd', 'basis'];
  const lines = items.map((i) => [i.kind, i.priority, i.resource?.resourceId ?? '', i.title, i.detail, i.monthlySaving.toFixed(2), i.monthlySaving3y?.toFixed(2) ?? '', i.basis].map(esc).join(','));
  return [head.join(','), ...lines].join('\n') + '\n';
}
