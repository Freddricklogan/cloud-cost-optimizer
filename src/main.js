/** Wires FOCUS ingestion, the analytics and the recommendations to the page and the Executive Shell. */
import { anomalies, dailySeries, forecastMonth, groupSum, monthOverMonth, monthlySeries, resourceSummary, totals } from './analysis.js';
import { loadChartLib, makeCharts } from './charts.js';
import { mountExecShell } from './exec-shell.js';
import { parseFocusCsv } from './focus.js';
import { DEFAULT_ASSUMPTIONS, recommend, recommendationsCsv } from './recommend.js';
import { $, el, setText } from './ui.js';

const state = { all: [], rows: [], warnings: [], source: 'data/focus-sample.csv (synthetic, seeded)', summary: [], items: [], forecast: null };
let charts = makeCharts(null);
let shell;
const usd = (v, d = 0) => `$${Number(v).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d })}`;
const pct = (v, d = 1) => (v === null || Number.isNaN(v) ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(d)}%`);

function assumptions() {
  return {
    ...DEFAULT_ASSUMPTIONS,
    idleUtilPct: Number($('a-idle').value),
    targetUtilPct: Number($('a-target').value),
    commit1yDiscount: Number($('a-1y').value) / 100,
    commit3yDiscount: Number($('a-3y').value) / 100
  };
}

function applyFilters() {
  const prov = $('f-provider').value;
  const env = $('f-env').value;
  state.rows = state.all.filter((r) => (prov === 'all' || r.provider === prov) && (env === 'all' || r.tags.env === env));
  render();
}

function fillFilters() {
  const provs = [...new Set(state.all.map((r) => r.provider))].sort();
  const envs = [...new Set(state.all.map((r) => r.tags.env).filter(Boolean))].sort();
  const fill = (sel, values, label) => {
    sel.replaceChildren(el('option', { value: 'all', text: `All ${label}` }));
    for (const v of values) sel.append(el('option', { value: v, text: v }));
  };
  fill($('f-provider'), provs, 'providers');
  fill($('f-env'), envs, 'environments');
}

function render() {
  const rows = state.rows;
  const budget = Number($('budget').value) || 0;
  const t = totals(rows);
  const f = forecastMonth(rows);
  const mom = monthOverMonth(rows);
  state.forecast = f;
  state.summary = resourceSummary(rows);
  state.items = recommend(state.summary, rows, assumptions());
  const savings = state.items.reduce((s, i) => s + i.monthlySaving, 0);
  const idle = state.items.filter((i) => i.kind === 'idle').length;
  const anomalyCount = anomalies(rows).length;

  setText('s-mtd', f ? usd(f.monthToDate) : '—');
  setText('s-mtd-sub', f ? `${f.month} · day ${f.elapsedDays} of ${f.daysInMonth}` : '');
  setText('s-projected', f ? usd(f.projected) : '—');
  setText('s-projected-sub', f ? `linear trend of the last 28 days${f.previousMonth ? ` · ${pct(((f.projected - f.previousMonth.billed) / f.previousMonth.billed) * 100)} vs ${f.previousMonth.month}` : ''}` : '');
  setText('s-budget', f && budget ? `${((f.projected / budget) * 100).toFixed(0)}%` : '—');
  setText('s-budget-sub', budget ? `of ${usd(budget)} projected` : 'set a budget');
  setText('s-mom', mom ? pct(mom.changePct) : '—');
  setText('s-mom-sub', mom ? `${mom.from} → ${mom.to} (complete months)` : 'needs two complete months');
  setText('s-savings', usd(savings));
  setText('s-savings-sub', `${state.items.filter((i) => i.monthlySaving > 0).length} actions · 1-year terms`);
  setText('s-idle', idle);
  setText('s-anom', anomalyCount);
  setText('s-period', `${rows.length.toLocaleString()} rows · ${dailySeries(rows).length} days · ${state.summary.length} resources · billed ${usd(t.billed)} · list ${usd(t.list)}`);
  const budgetEl = $('s-budget');
  budgetEl.className = `value ${f && budget && f.projected > budget ? 'is-danger' : f && budget && f.projected > 0.9 * budget ? 'is-warn' : ''}`;

  const months = monthlySeries(rows);
  charts.line($('monthChart'), months.map((m) => `${m.month}${m.days < 28 ? '*' : ''}`), [
    { label: 'Billed', data: months.map((m) => m.billed), fill: true },
    ...(budget ? [{ label: 'Budget', data: months.map(() => budget), colour: '#f85149', dash: [6, 4], width: 1 }] : [])
  ], 'Month (* partial)', 'USD');
  const daily = dailySeries(rows).slice(-90);
  charts.line($('dailyChart'), daily.map((d) => d.day.slice(5)), [{ label: 'Daily billed', data: daily.map((d) => d.billed) }], 'Day (last 90)', 'USD');
  const svc = groupSum(rows, 'service').slice(0, 10);
  charts.donut($('serviceChart'), svc.map((s) => s.label), svc.map((s) => s.billed));
  const prov = groupSum(rows, 'provider');
  charts.bars($('providerChart'), prov.map((p) => p.label), prov.map((p) => p.billed), 'Billed over the period (USD)');

  const tbody = $('resource-tbody');
  tbody.replaceChildren();
  for (const r of state.summary) {
    const tr = el('tr');
    const util = r.utilization === null ? '—' : `${r.utilization.toFixed(0)}%`;
    const tone = r.utilization === null ? '' : r.utilization < assumptions().idleUtilPct ? 'is-danger' : r.utilization < 50 ? 'is-warn' : 'is-ok';
    tr.append(el('td', { text: r.name }), el('td', { text: `${r.provider} · ${r.service}` }), el('td', { text: r.type || '—' }), el('td', { text: r.region }), el('td', { text: r.pricing }), el('td', { class: tone, text: util }), el('td', { text: usd(r.monthlyRun) }));
    tbody.append(tr);
  }

  const list = $('recs');
  list.replaceChildren();
  for (const i of state.items) {
    const li = el('li', { class: `rec rec--${i.priority}` });
    const h = el('h3');
    h.append(el('span', { text: i.title }), el('span', { class: `tag tag--${i.priority}`, text: i.priority }));
    li.append(h, el('p', { text: i.detail }));
    li.append(el('p', { class: 'basis', text: `${i.monthlySaving > 0 ? `${usd(i.monthlySaving)}/month${i.monthlySaving3y ? ` (3-year: ${usd(i.monthlySaving3y)})` : ''} — ` : ''}${i.basis}` }));
    list.append(li);
  }
  const kinds = ['idle', 'rightsize', 'commit'];
  charts.bars($('savingsChart'), ['Idle', 'Right-size', 'Commit (1-year)'], kinds.map((k) => state.items.filter((i) => i.kind === k).reduce((s, i) => s + i.monthlySaving, 0)), 'Identified monthly saving (USD)', '#3fb950');

  const warn = $('warnings');
  warn.replaceChildren();
  for (const w of state.warnings.slice(0, 20)) warn.append(el('li', { text: w }));
  $('warnings-panel').hidden = state.warnings.length === 0;
  setText('source-note', `Source: ${state.source}. Savings are arithmetic on the last 14 days' run rate and the assumptions in the sidebar; nothing is a quote.`);
  shell?.refreshKpis();
}

async function loadText(text, source) {
  try {
    const { rows, warnings } = parseFocusCsv(text);
    state.all = rows;
    state.warnings = warnings;
    state.source = source;
    setText('import-status', `Loaded ${rows.length.toLocaleString()} rows from ${source}${warnings.length ? ` · ${warnings.length} warning(s)` : ''}.`);
    fillFilters();
    applyFilters();
  } catch (err) {
    setText('import-status', `Import failed: ${err.message}`);
  }
}

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = el('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function boot() {
  const Chart = await loadChartLib();
  charts = makeCharts(Chart);
  if (!Chart) $('chart-notice').hidden = false;
  const text = await fetch('data/focus-sample.csv').then((r) => r.text());
  await loadText(text, state.source);

  $('file').addEventListener('change', async () => {
    const f = $('file').files[0];
    if (f) await loadText(await f.text(), f.name);
  });
  $('reload-sample').addEventListener('click', async () => loadText(await fetch('data/focus-sample.csv').then((r) => r.text()), 'data/focus-sample.csv (synthetic, seeded)'));
  for (const id of ['f-provider', 'f-env']) $(id).addEventListener('change', applyFilters);
  for (const id of ['budget', 'a-idle', 'a-target', 'a-1y', 'a-3y']) $(id).addEventListener('change', render);
  $('export-csv').addEventListener('click', () => download('recommendations.csv', recommendationsCsv(state.items), 'text/csv'));
  $('export-json').addEventListener('click', () => download('summary.json', JSON.stringify({ source: state.source, forecast: state.forecast, assumptions: assumptions(), recommendations: state.items.map((i) => ({ ...i, resource: i.resource?.resourceId ?? null })) }, null, 2), 'application/json'));

  shell = mountExecShell({
    title: 'Cloud Cost Optimizer',
    tagline: 'FinOps analysis over a FOCUS 1.0 cost export: month-end projection from the daily trend, month-over-month on complete months, anomaly detection per service, idle and right-sizing candidates from utilisation, and commitment savings from assumptions you can edit. Upload your own FOCUS CSV; nothing leaves the browser.',
    repo: 'https://github.com/Freddricklogan/cloud-cost-optimizer',
    pagesUrl: 'https://freddricklogan.github.io/cloud-cost-optimizer/',
    badges: [{ label: 'FOCUS 1.0 import', tone: 'accent' }, { label: 'Synthetic sample', dot: true }, { label: 'Assumptions editable', dot: true }],
    kpis: [
      { label: 'Month to date', compute: () => $('s-mtd').textContent, tone: 'accent' },
      { label: 'Projected month-end', compute: () => $('s-projected').textContent, tone: 'warn' },
      { label: 'Identified savings / mo', compute: () => $('s-savings').textContent, tone: 'ok' },
      { label: 'Idle resources', compute: () => $('s-idle').textContent, tone: 'danger' },
      { label: 'Anomalous days', compute: () => $('s-anom').textContent, tone: 'muted' }
    ],
    tour: [
      { selector: '#stats', title: 'Numbers with a method', body: 'Month-to-date is a sum. The projection is a linear trend of the last 28 days extrapolated to month end. Month-over-month compares only complete months — the partial month is starred in the chart.' },
      { selector: '#recs-panel', title: 'Every saving shows its basis', body: 'Idle is the full run rate. Right-sizing assumes one size step halves the price and only fires when utilisation stays under the target. Commitment savings use the discount you enter — the defaults are assumptions, not quotes.', action: () => { $('a-1y').value = '35'; render(); } },
      { selector: '#anomaly-note', title: 'Anomalies per service', body: 'A day is flagged when it exceeds the trailing 30-day mean by more than three standard deviations. The sample has a runaway BigQuery day and a Lambda retry storm.' },
      { selector: '#import-panel', title: 'Bring your own export', body: 'Upload a FOCUS 1.0 CSV — the open FinOps specification supported by AWS, Azure and Google exports. Rows that fail validation are listed, not silently dropped. Everything runs locally.', action: () => { $('f-provider').value = 'AWS'; applyFilters(); } }
    ]
  });
  shell.refreshKpis();
}

boot();
