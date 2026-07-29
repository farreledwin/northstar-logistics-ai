import recordsJson from "../data/logistics.json" with { type: "json" };
import { Dashboard } from "../components/dashboard";
import type { LogisticsRecord } from "../lib/analytics";

export default function Home() {
  return <Dashboard records={recordsJson as LogisticsRecord[]} />;
}
