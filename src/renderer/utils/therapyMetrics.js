// Thin re-export shim. The pure metric helpers now live in src/shared/metrics.js
// (shared with electron/main/services/therapyMetrics.js so the two processes can no
// longer drift). Kept for one release so existing `./utils/therapyMetrics` imports
// keep working; prefer importing from "../../shared/metrics" in new code.
export {
  calculatePercentile,
  formatMetricValue,
  toOptionalNumber,
  toOptionalNumber as toMetricNumber
} from "../../shared/metrics";
