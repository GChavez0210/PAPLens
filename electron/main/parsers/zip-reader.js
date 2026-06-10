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
const MAX_ENTRIES = 10_000;
const MAX_ENTRY_UNCOMPRESSED_SIZE = 200 * 1024 * 1024;
const MAX_TOTAL_UNCOMPRESSED_SIZE = 1024 * 1024 * 1024;

/**
 * Parse a ZIP buffer into a Map of entryName -> decompressed Buffer.
 * Directory entries (names ending in "/") are skipped.
 * Throws on a malformed archive or unsupported compression method.
 */
function readZipEntries(buf, options = {}) {
  const maxEntries = options.maxEntries ?? MAX_ENTRIES;
  const maxEntryUncompressedSize = options.maxEntryUncompressedSize ?? MAX_ENTRY_UNCOMPRESSED_SIZE;
  const maxTotalUncompressedSize = options.maxTotalUncompressedSize ?? MAX_TOTAL_UNCOMPRESSED_SIZE;
  const eocd = findEndOfCentralDirectory(buf);
  if (!eocd) throw new Error("ZIP end-of-central-directory record not found");
  if (eocd.totalEntries > maxEntries) {
    throw new Error("ZIP entry count exceeds safety limit");
  }

  const entries = new Map();
  let pos = eocd.centralDirOffset;
  let totalUncompressedSize = 0;

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
    if (pos + 46 + nameLen + extraLen + commentLen > buf.length) {
      throw new Error("ZIP central-directory entry exceeds archive bounds");
    }
    const name = buf.slice(pos + 46, pos + 46 + nameLen).toString("utf8");

    pos += 46 + nameLen + extraLen + commentLen;

    if (name.endsWith("/")) continue; // directory marker
    if (uncompressedSize > maxEntryUncompressedSize) {
      throw new Error("ZIP entry uncompressed size exceeds safety limit");
    }
    totalUncompressedSize += uncompressedSize;
    if (totalUncompressedSize > maxTotalUncompressedSize) {
      throw new Error("ZIP total uncompressed size exceeds safety limit");
    }

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
  if (dataStart + compressedSize > buf.length) {
    throw new Error("ZIP compressed entry exceeds archive bounds");
  }
  const compressed = buf.slice(dataStart, dataStart + compressedSize);

  let data;
  if (method === 0) {
    data = Buffer.from(compressed); // stored
  } else if (method === 8) {
    data = zlib.inflateRawSync(compressed); // DEFLATE
  } else {
    throw new Error(`Unsupported ZIP compression method ${method} (size ${uncompressedSize})`);
  }
  if (data.length !== uncompressedSize) {
    throw new Error("ZIP uncompressed size mismatch");
  }
  return data;
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

module.exports = {
  readZipEntries,
  limits: {
    MAX_ENTRIES,
    MAX_ENTRY_UNCOMPRESSED_SIZE,
    MAX_TOTAL_UNCOMPRESSED_SIZE
  }
};
