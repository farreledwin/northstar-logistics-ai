import assert from "node:assert/strict";
import test from "node:test";

import recordsJson from "../data/logistics.json" with { type: "json" };
import {
  executeAnalytics,
  fallbackPlan,
  forecastDemand,
  type LogisticsRecord,
} from "../lib/analytics.ts";

const records = recordsJson as LogisticsRecord[];

test("canonical delivery metrics match the source data", () => {
  const total = executeAnalytics(
    { metric: "total_orders", dimension: "none" },
    records,
  );
  const completed = executeAnalytics(
    { metric: "delivered_orders", dimension: "none" },
    records,
  );
  const delayed = executeAnalytics(
    { metric: "delayed_orders", dimension: "none" },
    records,
  );
  const onTime = executeAnalytics(
    { metric: "on_time_rate", dimension: "none" },
    records,
  );
  const deliveryDays = executeAnalytics(
    { metric: "average_delivery_days", dimension: "none" },
    records,
  );

  assert.equal(total.value, 400);
  assert.equal(completed.value, 359);
  assert.equal(delayed.value, 55);
  assert.ok(Math.abs(onTime.value! - 304 / 359) < 1e-12);
  assert.ok(Math.abs(deliveryDays.value! - 3.6880222841225627) < 1e-12);
});

test("relative dates are anchored to the dataset clock", () => {
  const plan = fallbackPlan("How many orders were delivered last month?", records);
  assert.equal(plan.name, "query_analytics");
  assert.equal(plan.arguments.dateFrom, "2025-11-01");
  assert.equal(plan.arguments.dateTo, "2025-11-30");
});

test("forecast supports category history but abstains for a sparse SKU", () => {
  const category = forecastDemand(
    {
      targetType: "category",
      target: "PENCIL",
      horizonMonths: 2,
      method: "moving_average",
    },
    records,
  );
  const sku = forecastDemand(
    {
      targetType: "sku",
      target: "PENCIL-0213",
      horizonMonths: 2,
      method: "moving_average",
    },
    records,
  );

  assert.equal(category.supported, true);
  assert.ok(category.recommendationUnits! > 0);
  assert.equal(sku.supported, false);
  assert.equal(sku.recommendationUnits, null);
});

test("time-series answers report the actual peak, not the first month", () => {
  const result = executeAnalytics(
    { metric: "total_orders", dimension: "month" },
    records,
  );
  const peak = result.rows.reduce((best, row) =>
    row.value > best.value ? row : best,
  );

  assert.match(result.answer, new RegExp(peak.label));
});
