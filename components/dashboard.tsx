"use client";

import { FormEvent, useMemo, useState } from "react";

import {
  executeAnalytics,
  filterRecords,
  forecastDemand,
  type ChartDatum,
  type LogisticsRecord,
  type ToolResult,
} from "../lib/analytics";

type ApiResult = {
  result: ToolResult;
  orchestration: {
    mode: "openai" | "deterministic_fallback";
    model: string | null;
    selectedTool: string;
    structuredArguments: Record<string, unknown>;
    note: string;
  };
};

const promptExamples = [
  "Show weekly order volume for the last 3 months",
  "Which carrier has the highest delay rate?",
  "Forecast PENCIL demand for the next 4 months",
];

function formatMetric(value: number, kind = "number") {
  if (kind === "percent") return `${(value * 100).toFixed(1)}%`;
  if (kind === "days") return `${value.toFixed(2)} d`;
  if (kind === "currency") {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(value);
  }
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(
    value,
  );
}

function LineChart({ data }: { data: ChartDatum[] }) {
  if (!data.length) return <p className="empty-state">No matching data.</p>;
  const width = 760;
  const height = 216;
  const padX = 24;
  const padY = 20;
  const maximum = Math.max(...data.map((item) => item.value), 1);
  const x = (index: number) =>
    padX + (index * (width - padX * 2)) / Math.max(data.length - 1, 1);
  const y = (value: number) =>
    height - padY - (value / maximum) * (height - padY * 2);
  const historyEnd = data.findIndex((item) => item.forecast != null);
  const historical = data
    .slice(0, historyEnd < 0 ? data.length : historyEnd)
    .map((item, index) => `${x(index)},${y(item.value)}`)
    .join(" ");
  const forecastStart = historyEnd > 0 ? historyEnd - 1 : historyEnd;
  const forecast =
    historyEnd < 0
      ? ""
      : data
          .slice(forecastStart)
          .map(
            (item, index) =>
              `${x(index + forecastStart)},${y(item.value)}`,
          )
          .join(" ");

  return (
    <div className="line-chart">
      <svg
        aria-label="Line chart"
        role="img"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
      >
        {[0.25, 0.5, 0.75, 1].map((fraction) => (
          <line
            className="chart-grid"
            key={fraction}
            x1={padX}
            x2={width - padX}
            y1={y(maximum * fraction)}
            y2={y(maximum * fraction)}
          />
        ))}
        <polyline className="chart-history" points={historical} />
        {forecast ? <polyline className="chart-forecast" points={forecast} /> : null}
      </svg>
      <div className="chart-axis">
        <span>{data[0]?.label}</span>
        <span>{data[Math.floor(data.length / 2)]?.label}</span>
        <span>{data.at(-1)?.label}</span>
      </div>
    </div>
  );
}

function BarChart({
  data,
  valueFormat = "number",
}: {
  data: ChartDatum[];
  valueFormat?: string;
}) {
  if (!data.length) return <p className="empty-state">No matching data.</p>;
  const maximum = Math.max(...data.map((item) => item.value), 0.01);
  return (
    <div className="bar-chart">
      {data.slice(0, 10).map((item) => (
        <div className="bar-row" key={item.label}>
          <span title={item.label}>{item.label}</span>
          <div className="bar-track">
            <i style={{ width: `${Math.max((item.value / maximum) * 100, 2)}%` }} />
          </div>
          <strong>{formatMetric(item.value, valueFormat)}</strong>
        </div>
      ))}
    </div>
  );
}

function ResultChart({ result }: { result: ToolResult }) {
  if (result.chart.type === "none") return null;
  return (
    <div className="result-chart">
      <div className="chart-heading">
        <h4>{result.chart.title}</h4>
        {result.tool === "forecast_demand" && result.supported ? (
          <div className="legend">
            <span><i className="legend-history" /> Historical</span>
            <span><i className="legend-forecast" /> Forecast</span>
          </div>
        ) : null}
      </div>
      {result.chart.type === "line" ? (
        <LineChart data={result.chart.data} />
      ) : (
        <BarChart
          data={result.chart.data}
          valueFormat={result.chart.valueFormat}
        />
      )}
    </div>
  );
}

export function Dashboard({ records }: { records: LogisticsRecord[] }) {
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [region, setRegion] = useState("");
  const [carrier, setCarrier] = useState("");
  const [question, setQuestion] = useState(promptExamples[1]);
  const [answer, setAnswer] = useState<ApiResult | null>(null);
  const [asking, setAsking] = useState(false);
  const [askError, setAskError] = useState("");
  const [forecastCategory, setForecastCategory] = useState("PENCIL");
  const [forecastHorizon, setForecastHorizon] = useState<1 | 2 | 3 | 4>(4);
  const [forecastMethod, setForecastMethod] = useState<
    "moving_average" | "linear_trend"
  >("moving_average");

  const regions = useMemo(
    () => [...new Set(records.map((record) => record.region))].sort(),
    [records],
  );
  const carriers = useMemo(
    () => [...new Set(records.map((record) => record.carrier))].sort(),
    [records],
  );
  const categories = useMemo(
    () =>
      [...new Set(records.map((record) => record.productCategory))].sort(),
    [records],
  );
  const filtered = useMemo(
    () =>
      filterRecords(records, {
        dateFrom: dateFrom || null,
        dateTo: dateTo || null,
        region: region || null,
        carrier: carrier || null,
      }),
    [records, dateFrom, dateTo, region, carrier],
  );
  const metric = (name: Parameters<typeof executeAnalytics>[0]["metric"]) =>
    executeAnalytics({ metric: name, dimension: "none" }, filtered).value ?? 0;
  const monthly = useMemo(
    () =>
      executeAnalytics(
        { metric: "total_orders", dimension: "month" },
        filtered,
      ),
    [filtered],
  );
  const carrierDelay = useMemo(
    () =>
      executeAnalytics(
        { metric: "delay_rate", dimension: "carrier", limit: 10 },
        filtered,
      ),
    [filtered],
  );
  const forecast = useMemo(
    () =>
      forecastDemand(
        {
          targetType: "category",
          target: forecastCategory,
          horizonMonths: forecastHorizon,
          method: forecastMethod,
        },
        records,
      ),
    [forecastCategory, forecastHorizon, forecastMethod, records],
  );
  const statusCounts = useMemo(
    () =>
      ["delivered", "delayed", "in_transit", "exception", "canceled"].map(
        (status) => ({
          status,
          count: filtered.filter((record) => record.status === status).length,
        }),
      ),
    [filtered],
  );

  async function ask(event: FormEvent) {
    event.preventDefault();
    if (!question.trim()) return;
    setAsking(true);
    setAskError("");
    try {
      const response = await fetch("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question }),
      });
      const payload = (await response.json()) as ApiResult & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Unable to answer.");
      setAnswer(payload);
    } catch (error) {
      setAskError(error instanceof Error ? error.message : "Unable to answer.");
    } finally {
      setAsking(false);
    }
  }

  const kpis = [
    { label: "Total orders", value: formatMetric(metric("total_orders")), note: "Unique order IDs" },
    { label: "Completed", value: formatMetric(metric("delivered_orders")), note: "Delivered + delayed" },
    { label: "Delayed", value: formatMetric(metric("delayed_orders")), note: "Completed late" },
    { label: "On-time rate", value: formatMetric(metric("on_time_rate"), "percent"), note: "Delivered / completed" },
    { label: "Avg. delivery", value: formatMetric(metric("average_delivery_days"), "days"), note: "Completed orders" },
  ];

  return (
    <main>
      <header className="site-header">
        <a className="brand" href="#overview" aria-label="Northstar overview">
          <span className="brand-mark">N</span>
          <span>Northstar <small>Logistics intelligence</small></span>
        </a>
        <nav aria-label="Primary navigation">
          <a href="#overview">Overview</a>
          <a href="#ask">Ask AI</a>
          <a href="#forecast">Forecast</a>
        </nav>
        <span className="data-badge"><i /> Data through 30 Dec 2025</span>
      </header>

      <section className="hero" id="overview">
        <div>
          <p className="eyebrow">Operations control center / 2025</p>
          <h1>From delivery data<br />to a defensible decision.</h1>
          <p className="hero-copy">
            Explore the operating picture, ask plain-English questions, and
            forecast demand without letting AI invent the numbers.
          </p>
        </div>
        <aside className="hero-callout">
          <span>Dataset integrity</span>
          <strong>400 / 400</strong>
          <p>unique order IDs · no duplicate rows detected</p>
        </aside>
      </section>

      <section className="filter-strip" aria-label="Dashboard filters">
        <label>
          From
          <input type="date" min="2025-01-01" max="2025-12-30" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
        </label>
        <label>
          To
          <input type="date" min="2025-01-01" max="2025-12-30" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
        </label>
        <label>
          Region
          <select value={region} onChange={(event) => setRegion(event.target.value)}>
            <option value="">All regions</option>
            {regions.map((item) => <option key={item}>{item}</option>)}
          </select>
        </label>
        <label>
          Carrier
          <select value={carrier} onChange={(event) => setCarrier(event.target.value)}>
            <option value="">All carriers</option>
            {carriers.map((item) => <option key={item}>{item}</option>)}
          </select>
        </label>
        <button className="reset-button" type="button" onClick={() => { setDateFrom(""); setDateTo(""); setRegion(""); setCarrier(""); }}>
          Reset filters
        </button>
        <p><strong>{filtered.length}</strong> matching records</p>
      </section>

      <section className="kpi-grid" aria-label="Key metrics">
        {kpis.map((item, index) => (
          <article className="kpi" key={item.label}>
            <span>0{index + 1} / {item.label}</span>
            <strong>{item.value}</strong>
            <p>{item.note}</p>
          </article>
        ))}
      </section>

      <section className="overview-grid">
        <article className="panel volume-panel">
          <div className="panel-heading">
            <div><p className="eyebrow">Demand signal</p><h2>Order volume by month</h2></div>
            <span>Peak: {monthly.rows.reduce((best, row) => row.value > best.value ? row : best, monthly.rows[0] ?? { label: "—", value: 0 }).label}</span>
          </div>
          <LineChart data={monthly.rows} />
        </article>
        <article className="panel status-panel">
          <div className="panel-heading">
            <div><p className="eyebrow">Service health</p><h2>Delivery status</h2></div>
          </div>
          <div className="status-total"><strong>{filtered.length}</strong><span>orders in view</span></div>
          <div className="status-stack" aria-label="Delivery status distribution">
            {statusCounts.map((item) => (
              <i key={item.status} className={`status-${item.status}`} style={{ width: `${filtered.length ? (item.count / filtered.length) * 100 : 0}%` }} />
            ))}
          </div>
          <div className="status-list">
            {statusCounts.map((item) => (
              <div key={item.status}><span><i className={`status-dot status-${item.status}`} />{item.status.replace("_", " ")}</span><strong>{item.count}</strong></div>
            ))}
          </div>
        </article>
        <article className="panel carrier-panel">
          <div className="panel-heading">
            <div><p className="eyebrow">Carrier comparison</p><h2>Delay rate</h2></div>
            <span>Delayed / completed</span>
          </div>
          <BarChart data={carrierDelay.rows} valueFormat="percent" />
        </article>
      </section>

      <section className="ai-section" id="ask">
        <div className="section-intro">
          <p className="eyebrow">Natural-language analytics</p>
          <h2>Ask the operation.<br />Inspect the reasoning.</h2>
          <p>
            AI only selects a constrained tool and arguments. A deterministic
            executor filters, aggregates, forecasts, and writes the answer.
          </p>
          <div className="example-list">
            {promptExamples.map((prompt) => (
              <button key={prompt} type="button" onClick={() => setQuestion(prompt)}>{prompt}<span>↗</span></button>
            ))}
          </div>
        </div>
        <div className="ask-console">
          <div className="console-top"><span><i /> Analytics copilot</span><small>Read-only</small></div>
          <form onSubmit={ask}>
            <label htmlFor="question">Question</label>
            <textarea id="question" maxLength={500} value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Ask about orders, delays, carriers, or demand…" />
            <div className="ask-actions"><small>{question.length}/500</small><button type="submit" disabled={asking}>{asking ? "Computing…" : "Run analysis →"}</button></div>
          </form>
          {askError ? <p className="error-message">{askError}</p> : null}
          {answer ? (
            <div className="answer-block">
              <div className="answer-header"><span>Computed answer</span><small>{answer.orchestration.mode === "openai" ? `Routed by ${answer.orchestration.model}` : "Deterministic fallback"}</small></div>
              <h3>{answer.result.answer}</h3>
              <ResultChart result={answer.result} />
              <details open>
                <summary>How this was computed</summary>
                <dl>
                  <div><dt>Tool</dt><dd>{answer.orchestration.selectedTool}</dd></div>
                  <div><dt>Filters</dt><dd>{answer.result.explainability.filters.join(" · ")}</dd></div>
                  <div><dt>Metric / dimension</dt><dd>{answer.result.explainability.metric} / {answer.result.explainability.dimension}</dd></div>
                  <div><dt>Query plan</dt><dd>{answer.result.explainability.queryPlan}</dd></div>
                  <div><dt>Rows scanned</dt><dd>{answer.result.explainability.recordCount}</dd></div>
                  <div><dt>Structured call</dt><dd><code>{JSON.stringify(answer.orchestration.structuredArguments)}</code></dd></div>
                </dl>
                <p className="orchestration-note">{answer.orchestration.note}</p>
              </details>
            </div>
          ) : (
            <div className="console-empty"><span>01</span><p>Submit a question to see the answer, visualization, tool call, filters, and query plan.</p></div>
          )}
        </div>
      </section>

      <section className="forecast-section" id="forecast">
        <div className="section-heading">
          <div><p className="eyebrow">Planning lab</p><h2>Demand forecast</h2></div>
          <p>A deliberately simple, explainable baseline built on monthly ordered quantity.</p>
        </div>
        <div className="forecast-controls">
          <label>Product category<select value={forecastCategory} onChange={(event) => setForecastCategory(event.target.value)}>{categories.map((item) => <option key={item}>{item}</option>)}</select></label>
          <label>Horizon<select value={forecastHorizon} onChange={(event) => setForecastHorizon(Number(event.target.value) as 1 | 2 | 3 | 4)}>{[1, 2, 3, 4].map((item) => <option key={item} value={item}>{item} month{item > 1 ? "s" : ""}</option>)}</select></label>
          <label>Method<select value={forecastMethod} onChange={(event) => setForecastMethod(event.target.value as "moving_average" | "linear_trend")}><option value="moving_average">3-month moving average</option><option value="linear_trend">Linear trend</option></select></label>
        </div>
        <div className="forecast-grid">
          <article className="panel forecast-chart">
            <div className="chart-heading"><h3>{forecast.chart.title}</h3><div className="legend"><span><i className="legend-history" /> Historical</span><span><i className="legend-forecast" /> Forecast</span></div></div>
            <LineChart data={forecast.chart.data} />
          </article>
          <aside className="forecast-decision">
            <p className="eyebrow">Next-month decision</p>
            <strong>{forecast.recommendationUnits ?? "—"}<small> units</small></strong>
            <p>{forecast.answer}</p>
            <dl><div><dt>Method</dt><dd>{forecast.method}</dd></div><div><dt>Buffer</dt><dd>10% assumption</dd></div><div><dt>History</dt><dd>{forecast.explainability.recordCount} orders</dd></div></dl>
          </aside>
        </div>
        <p className="forecast-caveat"><strong>Responsible limit:</strong> SKU-level forecasts abstain when fewer than four observed months are available. The source has no stock-on-hand, lead-time, or service-level fields, so the inventory output is a planning baseline—not an automated purchase order.</p>
      </section>

      <section className="data-section" id="data">
        <div className="section-heading"><div><p className="eyebrow">Evidence layer</p><h2>Underlying records</h2></div><p>First 8 rows from the current dashboard filter.</p></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Order</th><th>Date</th><th>Carrier</th><th>Destination</th><th>Status</th><th>Category</th><th>Qty</th><th>Value</th></tr></thead>
            <tbody>{filtered.slice(0, 8).map((record) => <tr key={record.orderId}><td>{record.orderId}</td><td>{record.orderDate}</td><td>{record.carrier}</td><td>{record.destinationCity}</td><td><span className={`table-status table-${record.status}`}>{record.status.replace("_", " ")}</span></td><td>{record.productCategory}</td><td>{record.quantity}</td><td>{formatMetric(record.orderValueUsd, "currency")}</td></tr>)}</tbody>
          </table>
        </div>
      </section>

      <footer><p>Northstar Logistics Intelligence</p><p>AI routes. Code computes. Evidence stays visible.</p><a href="#overview">Back to top ↑</a></footer>
    </main>
  );
}
