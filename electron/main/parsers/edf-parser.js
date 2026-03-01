const fs = require("fs");

class EDFParser {
  constructor() {
    this.header = null;
    this.signals = [];
    this.data = {};
  }

  parse(filePath) {
    const buffer = fs.readFileSync(filePath);
    return this.parseBuffer(buffer);
  }

  parseBuffer(buffer) {
    this.header = this.parseHeader(buffer);
    this.signals = this.parseSignalHeaders(buffer);
    this.data = this.parseDataRecords(buffer);
    return {
      header: this.header,
      signals: this.signals,
      data: this.data
    };
  }

  parseHeader(buffer) {
    const getString = (start, length) =>
      buffer.slice(start, start + length).toString("ascii").trim();
    const getInt = (start, length) => parseInt(getString(start, length), 10) || 0;
    const getFloat = (start, length) => parseFloat(getString(start, length)) || 0;

    return {
      version: getString(0, 8),
      patientId: getString(8, 80),
      recordingId: getString(88, 80),
      startDate: getString(168, 8),
      startTime: getString(176, 8),
      headerBytes: getInt(184, 8),
      reserved: getString(192, 44),
      numDataRecords: getInt(236, 8),
      dataRecordDuration: getFloat(244, 8),
      numSignals: getInt(252, 4)
    };
  }

  parseSignalHeaders(buffer) {
    const numSignals = this.header.numSignals;
    const signals = [];
    let offset = 256;

    const readField = (length) => {
      const values = [];
      for (let i = 0; i < numSignals; i++) {
        values.push(
          buffer.slice(offset + i * length, offset + (i + 1) * length).toString("ascii").trim()
        );
      }
      offset += numSignals * length;
      return values;
    };

    const labels = readField(16);
    const transducerTypes = readField(80);
    const physicalDimensions = readField(8);
    const physicalMinimums = readField(8);
    const physicalMaximums = readField(8);
    const digitalMinimums = readField(8);
    const digitalMaximums = readField(8);
    const prefiltering = readField(80);
    const samplesPerRecord = readField(8);
    const reserved = readField(32);

    for (let i = 0; i < numSignals; i++) {
      signals.push({
        label: labels[i],
        transducerType: transducerTypes[i],
        physicalDimension: physicalDimensions[i],
        physicalMinimum: parseFloat(physicalMinimums[i]) || 0,
        physicalMaximum: parseFloat(physicalMaximums[i]) || 0,
        digitalMinimum: parseInt(digitalMinimums[i], 10) || 0,
        digitalMaximum: parseInt(digitalMaximums[i], 10) || 0,
        prefiltering: prefiltering[i],
        samplesPerRecord: parseInt(samplesPerRecord[i], 10) || 0,
        reserved: reserved[i]
      });
    }

    return signals;
  }

  parseDataRecords(buffer) {
    const dataOffset = this.header.headerBytes;
    const numRecords = this.header.numDataRecords;
    const data = {};

    for (const signal of this.signals) {
      data[signal.label] = [];
    }

    let offset = dataOffset;
    for (let rec = 0; rec < numRecords && offset < buffer.length; rec++) {
      for (let sig = 0; sig < this.signals.length; sig++) {
        const signal = this.signals[sig];
        const numSamples = signal.samplesPerRecord;
        for (let samp = 0; samp < numSamples && offset + 1 < buffer.length; samp++) {
          const digitalValue = buffer.readInt16LE(offset);
          offset += 2;
          const physicalValue = this.digitalToPhysical(digitalValue, signal);
          data[signal.label].push(physicalValue);
        }
      }
    }

    return data;
  }

  digitalToPhysical(digital, signal) {
    const { physicalMinimum, physicalMaximum, digitalMinimum, digitalMaximum } = signal;
    if (digitalMaximum === digitalMinimum) {
      return digital;
    }
    const scale = (physicalMaximum - physicalMinimum) / (digitalMaximum - digitalMinimum);
    return physicalMinimum + (digital - digitalMinimum) * scale;
  }
}

function parseEDFDate(dateStr) {
  if (!dateStr) {
    return null;
  }

  const monthNames = {
    JAN: 0,
    FEB: 1,
    MAR: 2,
    APR: 3,
    MAY: 4,
    JUN: 5,
    JUL: 6,
    AUG: 7,
    SEP: 8,
    OCT: 9,
    NOV: 10,
    DEC: 11
  };

  const match = dateStr.match(/(\d{2})-([A-Z]{3})-(\d{4})/);
  if (match) {
    const day = parseInt(match[1], 10);
    const month = monthNames[match[2]];
    const year = parseInt(match[3], 10);
    if (month !== undefined) {
      return new Date(year, month, day);
    }
  }

  const match2 = dateStr.match(/(\d{2})\.(\d{2})\.(\d{2})/);
  if (match2) {
    const day = parseInt(match2[1], 10);
    const month = parseInt(match2[2], 10) - 1;
    let year = parseInt(match2[3], 10);
    year += year < 80 ? 2000 : 1900;
    return new Date(year, month, day);
  }

  return null;
}

function parseSTRFile(filePath) {
  const parser = new EDFParser();
  const result = parser.parse(filePath);
  const days = [];
  const numDays = result.header.numDataRecords;

  for (let i = 0; i < numDays; i++) {
    const day = {};
    for (const [label, values] of Object.entries(result.data)) {
      if (values[i] !== undefined) {
        day[label] = values[i];
      }
    }
    if (day.Date !== undefined) {
      const startDate = parseEDFDate(result.header.startDate);
      if (startDate) {
        const dayDate = new Date(startDate);
        dayDate.setDate(dayDate.getDate() + i);
        day._date = dayDate.toISOString().split("T")[0];
      }
    }
    days.push(day);
  }

  return {
    header: result.header,
    signals: result.signals,
    days
  };
}

function parseSessionFile(filePath) {
  const parser = new EDFParser();
  return parser.parse(filePath);
}

module.exports = {
  EDFParser,
  parseSTRFile,
  parseSessionFile
};
