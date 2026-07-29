import { readFile, writeFile } from "node:fs/promises";
import { parse } from "csv-parse/sync";

const source = new URL("../data/mock_logistics_data.csv", import.meta.url);
const output = new URL("../data/logistics.json", import.meta.url);
const csv = await readFile(source, "utf8");

const records = parse(csv, {
  columns: true,
  skip_empty_lines: true,
  trim: true,
}).map((row) => ({
  clientId: row.client_id,
  orderId: row.order_id,
  orderDate: row.order_date,
  deliveryDate: row.delivery_date || null,
  carrier: row.carrier,
  originCity: row.origin_city,
  destinationCity: row.destination_city,
  status: row.status,
  sku: row.sku,
  productCategory: row.product_category,
  quantity: Number(row.quantity),
  unitPriceUsd: Number(row.unit_price_usd),
  orderValueUsd: Number(row.order_value_usd),
  isPromo: row.is_promo === "1",
  promoDiscountPct: Number(row.promo_discount_pct),
  region: row.region,
  warehouse: row.warehouse,
}));

await writeFile(output, `${JSON.stringify(records, null, 2)}\n`);
console.log(`Prepared ${records.length} logistics records.`);
