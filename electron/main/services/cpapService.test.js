const test = require("node:test");
const assert = require("node:assert/strict");
const { measureSummaryPayload } = require("./cpapService");

function makeLogger() {
    return {
        infos: [],
        warns: [],
        info(message) { this.infos.push(message); },
        warn(message) { this.warns.push(message); }
    };
}

test("measureSummaryPayload logs byte size and summary counts", () => {
    const logger = makeLogger();
    const bytes = measureSummaryPayload({
        dailyStats: [{ date: "2026-06-10", ahi: 1 }],
        sessions: [{ id: "session-1" }]
    }, logger);

    assert.ok(bytes > 0);
    assert.equal(logger.warns.length, 0);
    assert.equal(logger.infos.length, 1);
    assert.match(logger.infos[0], /cpap:data-loaded payload=\d+ bytes/);
    assert.match(logger.infos[0], /dailyStats=1/);
    assert.match(logger.infos[0], /sessions=1/);
});
