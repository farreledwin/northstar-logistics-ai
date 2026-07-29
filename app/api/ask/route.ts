import OpenAI from "openai";
import type { FunctionTool } from "openai/resources/responses/responses";

import recordsJson from "../../../data/logistics.json" with { type: "json" };
import {
  executeAnalytics,
  fallbackPlan,
  forecastDemand,
  type AnalyticsPlan,
  type Dimension,
  type ForecastPlan,
  type LogisticsRecord,
  type Metric,
} from "../../../lib/analytics";

const records = recordsJson as LogisticsRecord[];
const carriers = [...new Set(records.map((record) => record.carrier))].sort();
const regions = [...new Set(records.map((record) => record.region))].sort();
const categories = [
  ...new Set(records.map((record) => record.productCategory)),
].sort();

const metrics: Metric[] = [
  "total_orders",
  "delivered_orders",
  "delayed_orders",
  "on_time_rate",
  "average_delivery_days",
  "order_quantity",
  "order_value",
  "delay_rate",
];
const dimensions: Dimension[] = [
  "none",
  "week",
  "month",
  "carrier",
  "destination",
  "region",
  "category",
];

const tools: FunctionTool[] = [
  {
    type: "function",
    name: "query_analytics",
    description:
      "Compute an exact logistics metric from read-only order data. Use this for historical questions, comparisons, rankings, and trends.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        metric: { type: "string", enum: metrics },
        dimension: { type: "string", enum: dimensions },
        date_from: {
          type: ["string", "null"],
          description: "Inclusive order date in YYYY-MM-DD, or null.",
        },
        date_to: {
          type: ["string", "null"],
          description: "Inclusive order date in YYYY-MM-DD, or null.",
        },
        carrier: { type: ["string", "null"], enum: [...carriers, null] },
        region: { type: ["string", "null"], enum: [...regions, null] },
        limit: { type: "integer", minimum: 1, maximum: 50 },
      },
      required: [
        "metric",
        "dimension",
        "date_from",
        "date_to",
        "carrier",
        "region",
        "limit",
      ],
    },
  },
  {
    type: "function",
    name: "forecast_demand",
    description:
      "Forecast monthly quantity for all products, one product category, or one exact SKU. Categories are: " +
      categories.join(", ") +
      ". Sparse SKU history may produce an explicit abstention.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        target_type: {
          type: "string",
          enum: ["overall", "category", "sku"],
        },
        target: {
          type: ["string", "null"],
          description:
            "Exact category or SKU. Must be null when target_type is overall.",
        },
        horizon_months: { type: "integer", enum: [1, 2, 3, 4] },
        method: {
          type: "string",
          enum: ["moving_average", "linear_trend"],
        },
      },
      required: ["target_type", "target", "horizon_months", "method"],
    },
  },
];

function validDate(value: unknown): value is string {
  return typeof value === "string" && /^2025-\d{2}-\d{2}$/.test(value);
}

function runTool(name: string, input: Record<string, unknown>) {
  if (name === "forecast_demand") {
    const targetType = ["overall", "category", "sku"].includes(
      String(input.target_type),
    )
      ? (input.target_type as ForecastPlan["targetType"])
      : "overall";
    const horizon = Number(input.horizon_months);
    const plan: ForecastPlan = {
      targetType,
      target: targetType === "overall" ? null : String(input.target ?? ""),
      horizonMonths: ([1, 2, 3, 4].includes(horizon) ? horizon : 4) as
        | 1
        | 2
        | 3
        | 4,
      method:
        input.method === "linear_trend" ? "linear_trend" : "moving_average",
    };
    return forecastDemand(plan, records);
  }

  const metric = metrics.includes(input.metric as Metric)
    ? (input.metric as Metric)
    : "total_orders";
  const dimension = dimensions.includes(input.dimension as Dimension)
    ? (input.dimension as Dimension)
    : "none";
  const plan: AnalyticsPlan = {
    metric,
    dimension,
    dateFrom: validDate(input.date_from) ? input.date_from : null,
    dateTo: validDate(input.date_to) ? input.date_to : null,
    carrier: carriers.includes(String(input.carrier))
      ? String(input.carrier)
      : null,
    region: regions.includes(String(input.region))
      ? String(input.region)
      : null,
    limit: Math.min(Math.max(Number(input.limit) || 50, 1), 50),
  };
  return executeAnalytics(plan, records);
}

export async function POST(request: Request) {
  const payload = (await request.json().catch(() => null)) as {
    question?: unknown;
  } | null;
  const question =
    typeof payload?.question === "string" ? payload.question.trim() : "";

  if (!question || question.length > 500) {
    return Response.json(
      { error: "Ask a question between 1 and 500 characters." },
      { status: 400 },
    );
  }

  const fallback = fallbackPlan(question, records);
  let selected =
    fallback.name === "forecast_demand"
      ? {
          name: fallback.name as string,
          arguments: {
            target_type: fallback.arguments.targetType,
            target: fallback.arguments.target,
            horizon_months: fallback.arguments.horizonMonths,
            method: fallback.arguments.method,
          } as Record<string, unknown>,
        }
      : {
          name: fallback.name as string,
          arguments: {
            metric: fallback.arguments.metric,
            dimension: fallback.arguments.dimension,
            date_from: fallback.arguments.dateFrom ?? null,
            date_to: fallback.arguments.dateTo ?? null,
            carrier: fallback.arguments.carrier ?? null,
            region: fallback.arguments.region ?? null,
            limit: fallback.arguments.limit ?? 50,
          } as Record<string, unknown>,
        };
  let mode: "openai" | "deterministic_fallback" = "deterministic_fallback";
  let note = "OpenAI is not configured; a transparent keyword router was used.";

  if (process.env.OPENAI_API_KEY) {
    try {
      const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const response = await client.responses.create({
        model: process.env.OPENAI_MODEL || "gpt-5.6-luna",
        store: false,
        reasoning: { effort: "none" },
        max_output_tokens: 300,
        parallel_tool_calls: false,
        tool_choice: "required",
        tools,
        instructions: `You route natural-language logistics questions to exactly one tool.
Success means selecting the correct metric, grouping, filters, forecast target, and method. Never calculate or answer directly.
The dataset contains 400 orders from 2025-01-01 through 2025-12-30. Interpret relative dates against that dataset clock: "last month" is November 2025 and "last 3 months" is October through December 2025.
Completed deliveries include statuses delivered and delayed. On-time rate is delivered / (delivered + delayed). Delay rate is delayed / (delivered + delayed). Use order_date for time filters.
Choose dimension none for a single number, week/month for trends, and carrier/destination/region/category for comparisons. Use a limit of 50 for time series and 10 for ranked comparisons.
For forecasts, default to the three-month moving average. Use linear trend only when the user explicitly asks for a trend method.`,
        input: question,
      });
      const call = response.output.find((item) => item.type === "function_call");
      if (call) {
        selected = {
          name: call.name,
          arguments: JSON.parse(call.arguments) as Record<string, unknown>,
        };
        mode = "openai";
        note =
          "OpenAI selected a structured tool call; all values and narrative were computed deterministically from the dataset.";
      }
    } catch {
      note =
        "The OpenAI router was unavailable, so the request used the deterministic fallback.";
    }
  }

  const result = runTool(selected.name, selected.arguments);
  return Response.json({
    result,
    orchestration: {
      mode,
      model: mode === "openai" ? process.env.OPENAI_MODEL || "gpt-5.6-luna" : null,
      selectedTool: selected.name,
      structuredArguments: selected.arguments,
      note,
    },
  });
}
