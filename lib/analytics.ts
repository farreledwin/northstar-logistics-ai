export type OrderStatus =
  | "delivered"
  | "delayed"
  | "in_transit"
  | "exception"
  | "canceled";

export interface LogisticsRecord {
  clientId: string;
  orderId: string;
  orderDate: string;
  deliveryDate: string | null;
  carrier: string;
  originCity: string;
  destinationCity: string;
  status: OrderStatus;
  sku: string;
  productCategory: string;
  quantity: number;
  unitPriceUsd: number;
  orderValueUsd: number;
  isPromo: boolean;
  promoDiscountPct: number;
  region: string;
  warehouse: string;
}

export type Metric =
  | "total_orders"
  | "delivered_orders"
  | "delayed_orders"
  | "on_time_rate"
  | "average_delivery_days"
  | "order_quantity"
  | "order_value"
  | "delay_rate";

export type Dimension =
  | "none"
  | "week"
  | "month"
  | "carrier"
  | "destination"
  | "region"
  | "category";

export interface Filters {
  dateFrom?: string | null;
  dateTo?: string | null;
  carrier?: string | null;
  region?: string | null;
}

export interface AnalyticsPlan extends Filters {
  metric: Metric;
  dimension: Dimension;
  limit?: number;
}

export interface ChartDatum {
  label: string;
  value: number;
  historical?: number | null;
  forecast?: number | null;
}

export interface AnalysisResult {
  tool: "query_analytics";
  answer: string;
  metric: Metric;
  dimension: Dimension;
  value: number | null;
  rows: Array<{ label: string; value: number }>;
  chart: {
    type: "line" | "bar" | "none";
    title: string;
    valueFormat: "number" | "percent" | "days" | "currency";
    data: ChartDatum[];
  };
  explainability: {
    filters: string[];
    metric: string;
    dimension: string;
    queryPlan: string;
    recordCount: number;
  };
}

export interface ForecastPlan {
  targetType: "overall" | "category" | "sku";
  target?: string | null;
  horizonMonths: 1 | 2 | 3 | 4;
  method: "moving_average" | "linear_trend";
}

export interface ForecastResult {
  tool: "forecast_demand";
  supported: boolean;
  answer: string;
  target: string;
  method: string;
  recommendationUnits: number | null;
  chart: {
    type: "line";
    title: string;
    valueFormat: "number";
    data: ChartDatum[];
  };
  explainability: {
    filters: string[];
    metric: string;
    dimension: string;
    queryPlan: string;
    recordCount: number;
  };
}

export type ToolResult = AnalysisResult | ForecastResult;

export const DATA_MAX_DATE = "2025-12-30";

export const METRIC_LABELS: Record<Metric, string> = {
  total_orders: "Total orders",
  delivered_orders: "Completed deliveries",
  delayed_orders: "Delayed orders",
  on_time_rate: "On-time delivery rate",
  average_delivery_days: "Average delivery time",
  order_quantity: "Order quantity",
  order_value: "Order value",
  delay_rate: "Delay rate",
};

const DIMENSION_LABELS: Record<Dimension, string> = {
  none: "No grouping",
  week: "Week",
  month: "Month",
  carrier: "Carrier",
  destination: "Destination",
  region: "Region",
  category: "Product category",
};

const completed = (record: LogisticsRecord) =>
  record.status === "delivered" || record.status === "delayed";

function dayDiff(from: string, to: string) {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
      86_400_000,
  );
}

export function filterRecords(
  records: LogisticsRecord[],
  filters: Filters = {},
) {
  return records.filter((record) => {
    if (filters.dateFrom && record.orderDate < filters.dateFrom) return false;
    if (filters.dateTo && record.orderDate > filters.dateTo) return false;
    if (filters.carrier && record.carrier !== filters.carrier) return false;
    if (filters.region && record.region !== filters.region) return false;
    return true;
  });
}

export function metricValue(metric: Metric, records: LogisticsRecord[]) {
  if (!records.length) return 0;

  const completedRecords = records.filter(completed);
  switch (metric) {
    case "total_orders":
      return new Set(records.map((record) => record.orderId)).size;
    case "delivered_orders":
      return completedRecords.length;
    case "delayed_orders":
      return records.filter((record) => record.status === "delayed").length;
    case "on_time_rate":
      return completedRecords.length
        ? completedRecords.filter((record) => record.status === "delivered")
            .length / completedRecords.length
        : 0;
    case "average_delivery_days": {
      const durations = completedRecords
        .filter((record) => record.deliveryDate)
        .map((record) => dayDiff(record.orderDate, record.deliveryDate!));
      return durations.length
        ? durations.reduce((sum, days) => sum + days, 0) / durations.length
        : 0;
    }
    case "order_quantity":
      return records.reduce((sum, record) => sum + record.quantity, 0);
    case "order_value":
      return records.reduce((sum, record) => sum + record.orderValueUsd, 0);
    case "delay_rate":
      return completedRecords.length
        ? completedRecords.filter((record) => record.status === "delayed")
            .length / completedRecords.length
        : 0;
  }
}

function startOfWeek(dateString: string) {
  const date = new Date(`${dateString}T00:00:00Z`);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - day + 1);
  return date.toISOString().slice(0, 10);
}

function dimensionKey(record: LogisticsRecord, dimension: Dimension) {
  switch (dimension) {
    case "week":
      return startOfWeek(record.orderDate);
    case "month":
      return record.orderDate.slice(0, 7);
    case "carrier":
      return record.carrier;
    case "destination":
      return record.destinationCity;
    case "region":
      return record.region;
    case "category":
      return record.productCategory;
    default:
      return "All records";
  }
}

function formatValue(metric: Metric, value: number) {
  if (metric === "on_time_rate" || metric === "delay_rate") {
    return `${(value * 100).toFixed(1)}%`;
  }
  if (metric === "average_delivery_days") return `${value.toFixed(2)} days`;
  if (metric === "order_value") {
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

function valueFormat(
  metric: Metric,
): AnalysisResult["chart"]["valueFormat"] {
  if (metric === "on_time_rate" || metric === "delay_rate") return "percent";
  if (metric === "average_delivery_days") return "days";
  if (metric === "order_value") return "currency";
  return "number";
}

function filterDescriptions(filters: Filters) {
  const descriptions: string[] = [];
  if (filters.dateFrom || filters.dateTo) {
    descriptions.push(
      `Order date: ${filters.dateFrom ?? "start"} to ${filters.dateTo ?? DATA_MAX_DATE}`,
    );
  } else {
    descriptions.push(`All order dates through ${DATA_MAX_DATE}`);
  }
  if (filters.carrier) descriptions.push(`Carrier: ${filters.carrier}`);
  if (filters.region) descriptions.push(`Region: ${filters.region}`);
  return descriptions;
}

export function executeAnalytics(
  plan: AnalyticsPlan,
  records: LogisticsRecord[],
): AnalysisResult {
  const filtered = filterRecords(records, plan);
  const metricLabel = METRIC_LABELS[plan.metric];
  const dimensionLabel = DIMENSION_LABELS[plan.dimension];
  const resultValue = metricValue(plan.metric, filtered);
  let rows: Array<{ label: string; value: number }> = [];

  if (plan.dimension !== "none") {
    const groups = new Map<string, LogisticsRecord[]>();
    for (const record of filtered) {
      const key = dimensionKey(record, plan.dimension);
      const group = groups.get(key);
      if (group) group.push(record);
      else groups.set(key, [record]);
    }
    rows = [...groups].map(([label, group]) => ({
      label,
      value: metricValue(plan.metric, group),
    }));
    rows.sort(
      plan.dimension === "week" || plan.dimension === "month"
        ? (a, b) => a.label.localeCompare(b.label)
        : (a, b) => b.value - a.value || a.label.localeCompare(b.label),
    );
    rows = rows.slice(0, Math.min(Math.max(plan.limit ?? 50, 1), 50));
  }

  const top = rows.reduce<(typeof rows)[number] | undefined>(
    (best, row) => (!best || row.value > best.value ? row : best),
    undefined,
  );
  const isTimeSeries = plan.dimension === "week" || plan.dimension === "month";
  const answer = top
    ? isTimeSeries
      ? `${metricLabel} is shown across ${rows.length} ${dimensionLabel.toLowerCase()} periods; the peak was ${top.label} at ${formatValue(plan.metric, top.value)}.`
      : `${top.label} has the highest ${metricLabel.toLowerCase()} at ${formatValue(plan.metric, top.value)} across ${rows.length} ${dimensionLabel.toLowerCase()} groups.`
    : `${metricLabel} is ${formatValue(plan.metric, resultValue)} for ${filtered.length} matching records.`;

  return {
    tool: "query_analytics",
    answer,
    metric: plan.metric,
    dimension: plan.dimension,
    value: plan.dimension === "none" ? resultValue : null,
    rows,
    chart: {
      type:
        plan.dimension === "none"
          ? "none"
          : plan.dimension === "week" || plan.dimension === "month"
            ? "line"
            : "bar",
      title:
        plan.dimension === "none"
          ? metricLabel
          : `${metricLabel} by ${dimensionLabel.toLowerCase()}`,
      valueFormat: valueFormat(plan.metric),
      data: rows,
    },
    explainability: {
      filters: filterDescriptions(plan),
      metric: metricLabel,
      dimension: dimensionLabel,
      queryPlan: `Filter read-only orders, group by ${dimensionLabel.toLowerCase()}, then compute ${metricLabel.toLowerCase()} deterministically.`,
      recordCount: filtered.length,
    },
  };
}

function nextMonth(month: string, offset: number) {
  const date = new Date(`${month}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + offset);
  return date.toISOString().slice(0, 7);
}

function monthlySeries(records: LogisticsRecord[]) {
  const totals = new Map<string, number>();
  for (const record of records) {
    const month = record.orderDate.slice(0, 7);
    totals.set(month, (totals.get(month) ?? 0) + record.quantity);
  }
  if (!totals.size) return [];
  const first = [...totals.keys()].sort()[0];
  const last = [...totals.keys()].sort().at(-1)!;
  const values: Array<{ month: string; value: number }> = [];
  for (let month = first; month <= last; month = nextMonth(month, 1)) {
    values.push({ month, value: totals.get(month) ?? 0 });
  }
  return values;
}

function linearForecast(values: number[], horizon: number) {
  const n = values.length;
  const sumX = (n * (n - 1)) / 2;
  const sumY = values.reduce((sum, value) => sum + value, 0);
  const sumXY = values.reduce((sum, value, index) => sum + value * index, 0);
  const sumX2 = values.reduce((sum, _, index) => sum + index * index, 0);
  const denominator = n * sumX2 - sumX * sumX;
  const slope = denominator ? (n * sumXY - sumX * sumY) / denominator : 0;
  const intercept = (sumY - slope * sumX) / n;
  return Array.from({ length: horizon }, (_, index) =>
    Math.max(0, Math.round(intercept + slope * (n + index))),
  );
}

export function forecastDemand(
  plan: ForecastPlan,
  records: LogisticsRecord[],
): ForecastResult {
  const target = plan.target?.trim() || null;
  const filtered = records.filter((record) => {
    if (plan.targetType === "category") {
      return record.productCategory.toLowerCase() === target?.toLowerCase();
    }
    if (plan.targetType === "sku") {
      return record.sku.toLowerCase() === target?.toLowerCase();
    }
    return true;
  });
  const series = monthlySeries(filtered);
  const observedMonths = new Set(
    filtered.map((record) => record.orderDate.slice(0, 7)),
  ).size;
  const label =
    plan.targetType === "overall"
      ? "All products"
      : `${plan.targetType.toUpperCase()} ${target ?? "unknown"}`;

  if (observedMonths < 4) {
    return {
      tool: "forecast_demand",
      supported: false,
      answer: `${label} has observations in only ${observedMonths} month(s). At least 4 observed months are required for a responsible forecast.`,
      target: label,
      method: "Insufficient history",
      recommendationUnits: null,
      chart: {
        type: "line",
        title: `Demand history — ${label}`,
        valueFormat: "number",
        data: series.map(({ month, value }) => ({
          label: month,
          value,
          historical: value,
          forecast: null,
        })),
      },
      explainability: {
        filters: [`Target: ${label}`, "Minimum history: 4 months"],
        metric: "Monthly order quantity",
        dimension: "Month",
        queryPlan:
          "Aggregate monthly quantity and abstain because the history threshold is not met.",
        recordCount: filtered.length,
      },
    };
  }

  const history = series.map((item) => item.value);
  const forecasts =
    plan.method === "linear_trend"
      ? linearForecast(history, plan.horizonMonths)
      : Array.from({ length: plan.horizonMonths }, () =>
          Math.round(history.slice(-3).reduce((sum, value) => sum + value, 0) / 3),
        );
  const lastMonth = series.at(-1)!.month;
  const chartData: ChartDatum[] = [
    ...series.map(({ month, value }) => ({
      label: month,
      value,
      historical: value,
      forecast: null,
    })),
    ...forecasts.map((value, index) => ({
      label: nextMonth(lastMonth, index + 1),
      value,
      historical: null,
      forecast: value,
    })),
  ];
  const recommendationUnits = Math.ceil(forecasts[0] * 1.1);
  const method =
    plan.method === "linear_trend"
      ? "Least-squares linear trend"
      : "Three-month moving average";

  return {
    tool: "forecast_demand",
    supported: true,
    answer: `${label} is forecast at ${forecasts[0]} units next month. Plan approximately ${recommendationUnits} units including a disclosed 10% buffer.`,
    target: label,
    method,
    recommendationUnits,
    chart: {
      type: "line",
      title: `Historical and forecast demand — ${label}`,
      valueFormat: "number",
      data: chartData,
    },
    explainability: {
      filters: [
        `Target: ${label}`,
        `Forecast horizon: ${plan.horizonMonths} month(s)`,
        "Inventory buffer: 10% (assumption; lead-time data is unavailable)",
      ],
      metric: "Monthly order quantity",
      dimension: "Month",
      queryPlan: `Aggregate quantity by month, apply ${method.toLowerCase()}, then add a 10% inventory buffer.`,
      recordCount: filtered.length,
    },
  };
}

function monthRange(month: string) {
  const start = `${month}-01`;
  const endDate = new Date(`${month}-01T00:00:00Z`);
  endDate.setUTCMonth(endDate.getUTCMonth() + 1);
  endDate.setUTCDate(0);
  return { start, end: endDate.toISOString().slice(0, 10) };
}

export function fallbackPlan(question: string, records: LogisticsRecord[]) {
  const text = question.toLowerCase();
  const categories = [...new Set(records.map((record) => record.productCategory))];
  const matchedCategory = categories.find((category) =>
    text.includes(category.toLowerCase()),
  );

  if (/forecast|predict|demand|inventory/.test(text)) {
    const sku = text.match(/[a-z]+-\d{4}/i)?.[0] ?? null;
    return {
      name: "forecast_demand" as const,
      arguments: {
        targetType: sku ? "sku" : matchedCategory ? "category" : "overall",
        target: sku ?? matchedCategory ?? null,
        horizonMonths: (Number(text.match(/next\s+([1-4])\s+months?/)?.[1]) || 4) as
          | 1
          | 2
          | 3
          | 4,
        method: "moving_average" as const,
      },
    };
  }

  let metric: Metric = "total_orders";
  if (/delay rate|highest delay/.test(text)) metric = "delay_rate";
  else if (/delayed|late/.test(text)) metric = "delayed_orders";
  else if (/on.?time/.test(text)) metric = "on_time_rate";
  else if (/average.*delivery|delivery.*time/.test(text)) {
    metric = "average_delivery_days";
  } else if (/quantity|units/.test(text)) metric = "order_quantity";
  else if (/revenue|value/.test(text)) metric = "order_value";
  else if (/delivered|completed/.test(text)) metric = "delivered_orders";

  let dimension: Dimension = "none";
  if (/week/.test(text)) dimension = "week";
  else if (/month|over time|trend/.test(text)) dimension = "month";
  else if (/carrier/.test(text)) dimension = "carrier";
  else if (/destination|city/.test(text)) dimension = "destination";
  else if (/region/.test(text)) dimension = "region";
  else if (/category|product/.test(text)) dimension = "category";

  const filters: Filters = {};
  if (/last month/.test(text)) {
    const lastMonth = nextMonth(DATA_MAX_DATE.slice(0, 7), -1);
    const range = monthRange(lastMonth);
    filters.dateFrom = range.start;
    filters.dateTo = range.end;
  } else if (/last 3 months/.test(text)) {
    filters.dateFrom = `${nextMonth(DATA_MAX_DATE.slice(0, 7), -2)}-01`;
    filters.dateTo = DATA_MAX_DATE;
  }

  return {
    name: "query_analytics" as const,
    arguments: { metric, dimension, ...filters, limit: 50 },
  };
}
