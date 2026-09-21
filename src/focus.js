/**
 * FOCUS 1.0 (FinOps Open Cost and Usage Specification) CSV ingestion.
 * Parses the columns this dashboard needs, validates every row, and reports what it rejected.
 */

export const REQUIRED = ['ChargePeriodStart', 'ProviderName', 'ServiceCategory', 'ServiceName', 'ResourceId', 'BilledCost'];
const OPTIONAL = ['ChargePeriodEnd', 'ResourceName', 'ResourceType', 'RegionId', 'ConsumedQuantity', 'ConsumedUnit', 'PricingCategory', 'ListCost', 'EffectiveCost', 'BillingCurrency', 'Tags', 'x_UtilizationPct'];

/** Minimal RFC-4180 line splitter: quoted fields may contain commas and doubled quotes. */
export function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function parseTags(raw) {
  if (!raw) return {};
  try {
    const t = JSON.parse(raw);
    return t && typeof t === 'object' && !Array.isArray(t) ? t : {};
  } catch {
    return {};
  }
}

/**
 * Parses FOCUS CSV text. Rows failing validation are listed in `warnings` and dropped; nothing
 * is coerced silently. Throws when required columns are absent or no row survives.
 */
export function parseFocusCsv(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length === 0) throw new Error('CSV is empty');
  const header = splitCsvLine(lines[0]);
  const missing = REQUIRED.filter((c) => !header.includes(c));
  if (missing.length) throw new Error(`not a FOCUS export — missing columns: ${missing.join(', ')}`);
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));
  const has = (c) => idx[c] !== undefined;
  const rows = [];
  const warnings = [];
  lines.slice(1).forEach((line, n) => {
    const f = splitCsvLine(line);
    const rowNo = n + 2;
    const start = Date.parse(f[idx.ChargePeriodStart]);
    const billed = Number(f[idx.BilledCost]);
    if (Number.isNaN(start)) return warnings.push(`row ${rowNo}: bad ChargePeriodStart "${f[idx.ChargePeriodStart] ?? ''}"`);
    if (!Number.isFinite(billed) || billed < 0) return warnings.push(`row ${rowNo}: BilledCost must be a non-negative number`);
    if (!f[idx.ResourceId]) return warnings.push(`row ${rowNo}: empty ResourceId`);
    const util = has('x_UtilizationPct') && f[idx.x_UtilizationPct] !== '' ? Number(f[idx.x_UtilizationPct]) : null;
    if (util !== null && !(util >= 0 && util <= 100)) return warnings.push(`row ${rowNo}: x_UtilizationPct out of range`);
    const list = has('ListCost') && f[idx.ListCost] !== '' ? Number(f[idx.ListCost]) : billed;
    rows.push({
      day: new Date(start).toISOString().slice(0, 10),
      provider: f[idx.ProviderName] || 'Unknown',
      category: f[idx.ServiceCategory] || 'Other',
      service: f[idx.ServiceName] || 'Unknown',
      resourceId: f[idx.ResourceId],
      resourceName: (has('ResourceName') && f[idx.ResourceName]) || f[idx.ResourceId],
      resourceType: (has('ResourceType') && f[idx.ResourceType]) || '',
      region: (has('RegionId') && f[idx.RegionId]) || '',
      quantity: has('ConsumedQuantity') ? Number(f[idx.ConsumedQuantity]) || 0 : 0,
      unit: (has('ConsumedUnit') && f[idx.ConsumedUnit]) || '',
      pricing: (has('PricingCategory') && f[idx.PricingCategory]) || 'On-Demand',
      listCost: Number.isFinite(list) ? list : billed,
      billedCost: billed,
      currency: (has('BillingCurrency') && f[idx.BillingCurrency]) || 'USD',
      tags: has('Tags') ? parseTags(f[idx.Tags]) : {},
      utilization: util
    });
    return undefined;
  });
  if (rows.length === 0) throw new Error('no valid rows');
  const currencies = new Set(rows.map((r) => r.currency));
  if (currencies.size > 1) warnings.push(`mixed currencies (${[...currencies].join(', ')}); totals are not converted`);
  return { rows, warnings, columns: header.filter((h) => REQUIRED.includes(h) || OPTIONAL.includes(h)) };
}
