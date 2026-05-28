"use strict";

const fs = require("fs");
const path = require("path");
const { CPAPDataLoader } = require("../services/cpap-data-loader");
const { ResventLoader } = require("./resvent-loader");
const { DeVilbissLoader } = require("./devilbiss-loader");
const { FisherPaykelLoader } = require("./fisher-paykel-loader");
const { LowensteinLoader } = require("./lowenstein-loader");

// Ordered list of non-ResMed loaders.  Each must implement a static detect(sdCardPath)
// that synchronously returns true when the folder belongs to that manufacturer.
const THIRD_PARTY_LOADERS = [
  ResventLoader,
  DeVilbissLoader,
  FisherPaykelLoader,
  LowensteinLoader
];

/**
 * Returns a loader instance appropriate for the given SD-card / data folder.
 * Falls back to CPAPDataLoader (ResMed) if no third-party loader matches.
 */
function getLoader(sdCardPath) {
  for (const Loader of THIRD_PARTY_LOADERS) {
    if (Loader.detect(sdCardPath)) {
      return new Loader(sdCardPath);
    }
  }
  const loader = new CPAPDataLoader(sdCardPath);
  loader.manufacturer = "ResMed";
  return loader;
}

/**
 * Returns true when at least one registered loader can handle the folder.
 * Used for folder-picker validation instead of hard-coding STR.edf checks.
 */
function detectDataFolder(sdCardPath) {
  if (!sdCardPath || !fs.existsSync(sdCardPath)) return false;
  if (THIRD_PARTY_LOADERS.some(L => L.detect(sdCardPath))) return true;
  // ResMed: must have STR.edf
  return fs.existsSync(path.join(sdCardPath, "STR.edf"));
}

module.exports = { getLoader, detectDataFolder };
