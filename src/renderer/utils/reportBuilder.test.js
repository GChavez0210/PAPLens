import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import Handlebars from "handlebars";
import { computeScores } from "./reportBuilder";

test("computeScores returns null for empty report data", () => {
    const warn = console.warn;
    console.warn = () => {};
    try {
        assert.equal(computeScores([]), null);
    } finally {
        console.warn = warn;
    }
});

test("computeScores returns stability metadata for analyzed days", () => {
    const result = computeScores([
        { usageHours: 7, therapy_stability_score: 91, mask_fit_score: null }
    ]);

    assert.equal(result.stabilityScore, 91);
    assert.equal(result.stabilityLabel, "Stable");
});

test("report template escapes profile names", () => {
    const template = fs.readFileSync(path.join(process.cwd(), "report.html"), "utf8");
    const render = Handlebars.compile(template);
    const html = render({
        profile: { name: "<script>alert(1)</script>" },
        device: { model: "Test", serialNumber: "123", firmware: "1.0" },
        report: { generatedAt: "2026-06-10", rangeLabel: "Test", sleepBoundaryLabel: "Noon" },
        summary: null,
        charts: {},
        branding: {},
        brand: {},
        header: {}
    });

    assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
    assert.equal(html.includes("<script>alert(1)</script>"), false);
});
