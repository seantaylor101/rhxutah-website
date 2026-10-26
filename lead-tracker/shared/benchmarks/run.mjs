// Usage: node shared/benchmarks/run.mjs <measurement.json from Export> [report-result.json]
// Prints how the wall map (and, if given, a report) compares with the
// HOVER reference for benchmark house A.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildHouseModel } from "../houseGeometry.js";
import { scoreOutline, scoreReport, formatScore } from "../benchmark.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const ref = JSON.parse(fs.readFileSync(path.join(here, "house-a-hover.json"), "utf8"));
const [measurementPath, reportPath] = process.argv.slice(2);
if (!measurementPath) {
  console.error("usage: node shared/benchmarks/run.mjs <measurement.json> [report-result.json]");
  process.exit(1);
}
const m = JSON.parse(fs.readFileSync(measurementPath, "utf8"));
const model = buildHouseModel(m.project);
console.log("Wall map vs HOVER footprint\n" + formatScore(scoreOutline(model, ref)));
if (reportPath) {
  const result = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  console.log("\nReport vs HOVER\n" + formatScore(scoreReport(result.result || result, ref)));
}
