"use strict";

// Minimal ZIP archive reader (no external dependency).
//
// Supports the two compression methods used by Löwenstein Prisma Line
// containers (config.pcfg / therapy.pdat):
//   method 0 — stored (no compression)
//   method 8 — DEFLATE (decompressed with Node's built-in zlib.inflateRawSync)
//
// Reads entries via the central directory so compressed/uncompressed sizes are
// authoritative even when local headers use streaming data descriptors.
// ZIP64 and encrypted entries are not supported.

const zlib = require("zlib");

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;
const LOC_SIG = 0x04034b50;
const EOCD_MIN_SIZE = 22;

/**
 * Parse a ZIP buffer into a Map of entryName -> decompressed Buffer.
 * Directory entries (names ending in "/") are skipped.
 * Throws on a malformed archive or unsupported compression method.
 */
function readZipEntries(buf) {
  const eocd = findEndOfCentralDirectory(buf);
  if (!eocd) throw new Error("ZIP end-of-central-directory record not found");

  const entries = new Map();
  let pos = eocd.centralDirOffset;

  for (let i = 0; i < eocd.totalEntries; i++) {
    if (pos + 46 > buf.length || buf.readUInt32LE(pos) !== CEN_SIG) {
      throw new Error("ZIP central-directory entry signature mismatch");
    }
    const method = buf.readUInt16LE(pos + 10);
    const compressedSize = buf.readUInt32LE(pos + 20);
    const uncompressedSize = buf.readUInt32LE(pos + 24);
    const nameLen = buf.readUInt16LE(pos + 28);
    const extraLen = buf.readUInt16LE(pos + 30);
    const commentLen = buf.readUInt16LE(pos + 32);
    const localOffset = buf.readUInt32LE(pos + 42);
    const name = buf.slice(pos + 46, pos + 46 + nameLen).toString("utf8");

    pos += 46 + nameLen + extraLen + commentLen;

    if (name.endsWith("/")) continue; // directory marker

    const data = extractEntry(buf, localOffset, method, compressedSize, uncompressedSize);
    entries.set(name, data);
  }

  return entries;
}

function extractEntry(buf, localOffset, method, compressedSize, uncompressedSize) {
  if (localOffset + 30 > buf.length || buf.readUInt32LE(localOffset) !== LOC_SIG) {
    throw new Error("ZIP local-file-header signature mismatch");
  }
  // Local header name/extra lengths can differ from the central directory's,
  // so always read them from the local header to locate the data start.
  const nameLen = buf.readUInt16LE(localOffset + 26);
  const extraLen = buf.readUInt16LE(localOffset + 28);
  const dataStart = localOffset + 30 + nameLen + extraLen;
  const compressed = buf.slice(dataStart, dataStart + compressedSize);

  if (method === 0) {
    return Buffer.from(compressed); // stored
  }
  if (method === 8) {
    return zlib.inflateRawSync(compressed); // DEFLATE
  }
  throw new Error(`Unsupported ZIP compression method ${method} (size ${uncompressedSize})`);
}

function findEndOfCentralDirectory(buf) {
  if (buf.length < EOCD_MIN_SIZE) return null;
  // The EOCD lives at the end, optionally followed by a comment (≤ 65535 bytes).
  const minPos = Math.max(0, buf.length - EOCD_MIN_SIZE - 0xffff);
  for (let pos = buf.length - EOCD_MIN_SIZE; pos >= minPos; pos--) {
    if (buf.readUInt32LE(pos) === EOCD_SIG) {
      const commentLen = buf.readUInt16LE(pos + 20);
      if (pos + EOCD_MIN_SIZE + commentLen !== buf.length) continue; // false positive
      return {
        totalEntries: buf.readUInt16LE(pos + 10),
        centralDirOffset: buf.readUInt32LE(pos + 16)
      };
    }
  }
  return null;
}

module.exports = { readZipEntries };
