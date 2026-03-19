# Cloud Infrastructure Cost Optimizer

A multi-cloud FinOps dashboard for analyzing, comparing, and optimizing cloud infrastructure costs across AWS, Azure, and GCP. Single-page web application with interactive visualizations and actionable recommendations.

## Features

### Multi-Cloud Cost Analysis
- Unified view across AWS, Azure, and GCP
- Per-provider cost breakdowns and comparisons
- Resource inventory with utilization tracking
- Budget monitoring with threshold alerts

### Cost Optimization Engine
- **Right-Sizing** — Identifies over-provisioned resources and recommends downsizing
- **Reserved Instance Analysis** — Compares on-demand vs 1-year and 3-year commitments
- **Idle Resource Detection** — Flags resources below 20% utilization
- **Storage Tiering** — Recommends lifecycle policies for hot-to-archive migration
- **Spot/Preemptible Opportunities** — Identifies non-critical workloads for spot pricing
- **Network Optimization** — Analyzes egress costs and CDN opportunities

### Interactive Visualizations
- **Cost Breakdown** — Service-level spending distribution
- **Cost Trend** — Monthly spending trajectory vs budget
- **Provider Comparison** — Side-by-side cloud provider costs
- **Savings Projection** — Cumulative savings forecast from optimizations

### Resource Management
- Detailed resource cards with type, size, region, and utilization
- Utilization-based color coding (healthy, underutilized, idle)
- Click-through filtering by cloud provider

### Reporting
- Prioritized optimization recommendations with estimated savings
- Right-sizing analysis with current vs recommended instance types
- Reserved instance cost comparison table

## Technologies

- **JavaScript** — Cost modeling, optimization engine, and analytics
- **Chart.js** — Cost breakdown, trend, and comparison charts
- **HTML5/CSS3** — Responsive dashboard layout
- **Client-Side Only** — No backend or API keys required

## How to Use

1. Open `index.html` in any modern browser
2. Select a cloud provider (AWS, Azure, GCP) or view all clouds combined
3. Review the cost dashboard and resource inventory
4. Click **Run Optimization Analysis** to generate recommendations
5. Review right-sizing suggestions and reserved instance analysis

## Use Cases

- **FinOps Practice** — Cloud financial management and cost governance
- **Cloud Architecture** — Right-sizing and capacity planning exercises
- **DevOps Training** — Understanding cloud cost structures and optimization
- **Executive Reporting** — Cloud spending visualization and budget tracking

## License

MIT License
