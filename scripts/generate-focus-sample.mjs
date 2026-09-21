/**
 * Generates data/focus-sample.csv: a seeded, synthetic FinOps dataset in FOCUS 1.0 column layout
 * (FinOps Open Cost and Usage Specification), one row per resource per day for 183 days across
 * AWS, Azure and GCP. Nothing here is a real bill. Run: node scripts/generate-focus-sample.mjs
 */
import { writeFileSync } from 'node:fs';
import { mulberry32 } from './rng.js';

const END = new Date(Date.UTC(2026, 8, 20)); // last full day in the file
const DAYS = 183;
const u = mulberry32(2026);
const gauss = () => { const a = u() || 1e-12; return Math.sqrt(-2 * Math.log(a)) * Math.cos(2 * Math.PI * u()); };

// dailyList = on-demand list cost per day; pricing = On-Demand | Committed; util = mean utilisation (%) for compute
const R = [
  ['AWS', 'Compute', 'Amazon EC2', 'i-0a1prodapi', 'prod-api-cluster', 'm5.2xlarge', 'us-east-1', 4, 0.384 * 24, 'Committed', 72, 'prod', 'api'],
  ['AWS', 'Compute', 'Amazon EC2', 'i-0b2prodweb', 'prod-web-asg', 'c5.xlarge', 'us-east-1', 6, 0.17 * 24, 'On-Demand', 45, 'prod', 'web'],
  ['AWS', 'Compute', 'Amazon EC2', 'i-0c3staging', 'staging-servers', 'm5.xlarge', 'us-east-1', 3, 0.192 * 24, 'On-Demand', 15, 'staging', 'web'],
  ['AWS', 'Compute', 'Amazon EC2', 'i-0d4dev', 'dev-instances', 't3.large', 'us-west-2', 8, 0.0832 * 24, 'On-Demand', 8, 'dev', 'platform'],
  ['AWS', 'Databases', 'Amazon RDS', 'db-prod-primary', 'prod-database', 'db.r5.2xlarge', 'us-east-1', 2, 0.96 * 24, 'On-Demand', 65, 'prod', 'data'],
  ['AWS', 'Databases', 'Amazon RDS', 'db-analytics', 'analytics-db', 'db.r5.xlarge', 'us-east-1', 1, 0.48 * 24, 'On-Demand', 30, 'prod', 'data'],
  ['AWS', 'Storage', 'Amazon S3', 's3-app-data', 'app-data', 'Standard', 'us-east-1', 1, 12400 * 0.023 / 30, 'On-Demand', null, 'prod', 'data'],
  ['AWS', 'Storage', 'Amazon S3', 's3-logs-archive', 'logs-archive', 'Standard', 'us-east-1', 1, 45200 * 0.023 / 30, 'On-Demand', null, 'prod', 'platform'],
  ['AWS', 'Databases', 'Amazon ElastiCache', 'cache-prod', 'prod-cache', 'cache.r6g.xlarge', 'us-east-1', 2, 0.411 * 24, 'On-Demand', 55, 'prod', 'api'],
  ['AWS', 'Compute', 'AWS Lambda', 'fn-api', 'api-functions', '1024 MB', 'us-east-1', 1, 10.5, 'On-Demand', null, 'prod', 'api'],
  ['AWS', 'Networking', 'Amazon CloudFront', 'cf-dist', 'cdn-distribution', 'Global', 'global', 1, 15, 'On-Demand', null, 'prod', 'web'],
  ['AWS', 'Networking', 'AWS Data Transfer', 'dt-out', 'data-transfer', 'Outbound', 'us-east-1', 1, 36, 'On-Demand', null, 'prod', 'platform'],
  ['Azure', 'Compute', 'Virtual Machines', 'vm-prod', 'prod-vms', 'Standard_D4s_v3', 'eastus', 5, 0.192 * 24, 'Committed', 68, 'prod', 'web'],
  ['Azure', 'Compute', 'Azure Kubernetes Service', 'aks-prod', 'aks-cluster', 'Standard_D8s_v3', 'eastus', 3, 0.384 * 24, 'On-Demand', 60, 'prod', 'api'],
  ['Azure', 'Compute', 'Virtual Machines', 'vm-staging', 'staging-vms', 'Standard_B4ms', 'eastus', 4, 0.166 * 24, 'On-Demand', 12, 'staging', 'web'],
  ['Azure', 'Databases', 'Azure SQL Database', 'sql-primary', 'sql-primary', 'BC_Gen5_8', 'eastus', 1, 73, 'On-Demand', 55, 'prod', 'data'],
  ['Azure', 'Databases', 'Azure Cosmos DB', 'cosmos-main', 'cosmos-db', '400 RU/s', 'eastus', 1, 19, 'On-Demand', 35, 'prod', 'api'],
  ['Azure', 'Storage', 'Azure Blob Storage', 'blob-data', 'blob-storage', 'Hot', 'eastus', 1, 8700 * 0.0184 / 30 * 4.7, 'On-Demand', null, 'prod', 'data'],
  ['Azure', 'Storage', 'Azure Blob Storage', 'blob-archive', 'archive-storage', 'Hot', 'eastus', 1, 38000 * 0.0184 / 30 * 1.35, 'On-Demand', null, 'prod', 'platform'],
  ['Azure', 'Compute', 'App Service', 'app-svc', 'app-service', 'P2v3', 'eastus', 2, 0.32 * 24 * 1.2, 'On-Demand', 50, 'prod', 'web'],
  ['Azure', 'Compute', 'Azure Functions', 'func-main', 'functions', 'EP1', 'eastus', 1, 9.3, 'On-Demand', 30, 'prod', 'api'],
  ['Azure', 'Networking', 'Bandwidth', 'bw-out', 'bandwidth', 'Outbound', 'eastus', 1, 28, 'On-Demand', null, 'prod', 'platform'],
  ['GCP', 'Compute', 'Kubernetes Engine', 'gke-prod', 'gke-cluster', 'n2-standard-8', 'us-central1', 4, 0.3885 * 24, 'On-Demand', 65, 'prod', 'api'],
  ['GCP', 'Compute', 'Compute Engine', 'gce-vms', 'compute-vms', 'n2-standard-4', 'us-central1', 3, 0.194 * 24, 'On-Demand', 40, 'prod', 'web'],
  ['GCP', 'Compute', 'Compute Engine', 'gce-dev', 'dev-vms', 'e2-medium', 'us-central1', 6, 0.0335 * 24, 'On-Demand', 10, 'dev', 'platform'],
  ['GCP', 'Databases', 'Cloud SQL', 'csql-main', 'cloud-sql', 'db-custom-8-32768', 'us-central1', 2, 18.3, 'On-Demand', 50, 'prod', 'data'],
  ['GCP', 'Analytics', 'BigQuery', 'bq-main', 'bigquery', 'On-demand', 'us', 1, 22.6, 'On-Demand', null, 'prod', 'data'],
  ['GCP', 'Storage', 'Cloud Storage', 'gcs-data', 'gcs-data', 'Standard', 'us-central1', 1, 7200 * 0.02 / 30 * 3.75, 'On-Demand', null, 'prod', 'data'],
  ['GCP', 'Storage', 'Cloud Storage', 'gcs-archive', 'gcs-archive', 'Standard', 'us-central1', 1, 22000 * 0.02 / 30 * 0.86, 'On-Demand', null, 'prod', 'platform'],
  ['GCP', 'Compute', 'Cloud Run', 'run-svcs', 'cloud-run', '2 vCPU', 'us-central1', 8, 1.46, 'On-Demand', 35, 'prod', 'api'],
  ['GCP', 'Networking', 'Network Egress', 'egress', 'egress', 'Outbound', 'us-central1', 1, 24, 'On-Demand', null, 'prod', 'platform']
];

const COMMIT_DISCOUNT = 0.40; // synthetic: committed rows billed at 60 % of list
const iso = (d) => d.toISOString().slice(0, 19) + 'Z';
const rows = [['BillingAccountId', 'ChargePeriodStart', 'ChargePeriodEnd', 'ProviderName', 'ServiceCategory', 'ServiceName', 'ResourceId', 'ResourceName', 'ResourceType', 'RegionId', 'ConsumedQuantity', 'ConsumedUnit', 'PricingCategory', 'ListCost', 'BilledCost', 'EffectiveCost', 'BillingCurrency', 'Tags', 'x_UtilizationPct']];
for (let d = DAYS - 1; d >= 0; d -= 1) {
  const start = new Date(END.getTime() - d * 86400000);
  const end = new Date(start.getTime() + 86400000);
  const t = (DAYS - 1 - d) / (DAYS - 1);
  const weekend = start.getUTCDay() === 0 || start.getUTCDay() === 6;
  for (const [prov, cat, svc, id, name, type, region, count, daily, pricing, util, env, team] of R) {
    let growth = 1 + 0.22 * t; // gentle growth over the six months
    if (svc === 'AWS Data Transfer' && d < 30) growth *= 1.55; // egress step-change in the last month
    const usageNoise = cat === 'Storage' ? 1 + 0.01 * gauss() : 1 + 0.08 * gauss();
    const weekendFactor = cat === 'Compute' && env === 'prod' && (svc.includes('Lambda') || svc.includes('Run') || svc.includes('Functions')) ? (weekend ? 0.6 : 1) : 1;
    let list = daily * count * growth * usageNoise * weekendFactor;
    if (id === 'bq-main' && d === 41) list *= 9.5; // one runaway query day
    if (id === 'fn-api' && d === 12) list *= 4.2; // a retry storm
    list = Math.max(0, list);
    const billed = pricing === 'Committed' ? list * (1 - COMMIT_DISCOUNT) : list;
    const qty = cat === 'Storage' ? Number((list / 0.02).toFixed(1)) : cat === 'Compute' && util !== null ? count * 24 : Number(list.toFixed(2));
    const unit = cat === 'Storage' ? 'GB-Month' : cat === 'Compute' && util !== null ? 'Hours' : 'USD';
    const u0 = util === null ? '' : Math.min(100, Math.max(0, util + 6 * gauss() + (weekend && env === 'prod' ? -8 : 0))).toFixed(1);
    rows.push(['acct-0001', iso(start), iso(end), prov, cat, svc, id, name, type, region, qty, unit, pricing, list.toFixed(4), billed.toFixed(4), billed.toFixed(4), 'USD', JSON.stringify({ env, team }).replaceAll('"', '""'), u0]);
  }
}
const csv = rows.map((r, n) => r.map((v, i) => (i === 17 && n > 0 ? `"${v}"` : v)).join(",")).join("\n") + "\n";
writeFileSync(new URL('../data/focus-sample.csv', import.meta.url), csv);
console.log(`wrote ${rows.length - 1} rows, ${R.length} resources, ${DAYS} days ending ${iso(END).slice(0, 10)}`);
