const test = require("node:test");
const assert = require("node:assert/strict");
const zlib = require("zlib");
const { readZipEntries, limits } = require("./zip-reader");

function buildZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const compressed = entry.method === 8 ? zlib.deflateRawSync(entry.data) : Buffer.from(entry.data);
    const uncompressedSize = entry.uncompressedSize ?? entry.data.length;
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(entry.method, 8);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(uncompressedSize, 22);
    local.writeUInt16LE(name.length, 26);
    name.copy(local, 30);
    locals.push(local, compressed);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(entry.method, 10);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(uncompressedSize, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);
    centrals.push(central);

    offset += local.length + compressed.length;
  }

  const centralDirOffset = offset;
  const centralDir = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(centralDirOffset, 16);

  return Buffer.concat([...locals, centralDir, eocd]);
}

test("readZipEntries decodes stored and deflated entries", () => {
  const zip = buildZip([
    { name: "config.txt", method: 0, data: Buffer.from("plain") },
    { name: "therapy.xml", method: 8, data: Buffer.from("<therapy />") }
  ]);

  const entries = readZipEntries(zip);

  assert.equal(entries.get("config.txt").toString("utf8"), "plain");
  assert.equal(entries.get("therapy.xml").toString("utf8"), "<therapy />");
});

test("readZipEntries rejects entries whose declared uncompressed size exceeds the cap", () => {
  const zip = buildZip([
    {
      name: "bomb.bin",
      method: 8,
      data: Buffer.from("small"),
      uncompressedSize: limits.MAX_ENTRY_UNCOMPRESSED_SIZE + 1
    }
  ]);

  assert.throws(() => readZipEntries(zip), /uncompressed size exceeds safety limit/);
});

test("readZipEntries rejects archives with too many entries", () => {
  const zip = buildZip([
    { name: "one.txt", method: 0, data: Buffer.from("1") },
    { name: "two.txt", method: 0, data: Buffer.from("2") }
  ]);

  assert.throws(() => readZipEntries(zip, { maxEntries: 1 }), /entry count exceeds safety limit/);
});

test("readZipEntries rejects archives over the cumulative uncompressed-size cap", () => {
  const zip = buildZip([
    { name: "one.txt", method: 0, data: Buffer.from("12345") },
    { name: "two.txt", method: 0, data: Buffer.from("67890") }
  ]);

  assert.throws(
    () => readZipEntries(zip, { maxTotalUncompressedSize: 9 }),
    /total uncompressed size exceeds safety limit/
  );
});

test("readZipEntries rejects uncompressed size mismatches", () => {
  const zip = buildZip([
    { name: "wrong.bin", method: 8, data: Buffer.from("small"), uncompressedSize: 3 }
  ]);

  assert.throws(() => readZipEntries(zip), /uncompressed size mismatch/);
});
