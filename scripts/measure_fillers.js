// Accuracy scorer for hand-labeled takes: how well do the delivery rules in
// frontend/delivery.js find the fillers a careful listener hears?
//
// Usage: node scripts/measure_fillers.js samples/labeled
//
// Each *.json file in the folder is one take:
//   { "name": "...", "transcript": [{"text", "start", "end"}],
//     "labels": {"hesitation": [word indexes], "habit": [word indexes]}, "missed": 1 }
//
// Precision = flagged words that are labeled / flagged words.
// Recall = labeled words that are flagged / labeled words.
// Either prints as "-" when there is nothing to divide by (and is null, never NaN).
//
// `missed` counts fillers you heard that the transcript does not contain at all. The rules
// cannot find a word that is not there, so `missed` does NOT lower the printed recall, which
// measures the rules alone. It is shown in its own column so transcription losses stay visible.
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const KINDS = ["hesitation", "habit"];

function loadDelivery() {
  const source = fs.readFileSync(path.join(__dirname, "..", "frontend", "delivery.js"), "utf8");
  const app = {};
  vm.runInNewContext(source, { app }, { filename: "delivery.js" });
  return app.delivery;
}

function ratio(numerator, denominator) {
  return denominator === 0 ? null : numerator / denominator;
}

// Counts for one kind, from the flagged and labeled totals (also used to sum a total row).
function withRatios(flagged, labeled, correct) {
  return {
    flagged,
    labeled,
    correct,
    precision: ratio(correct, flagged),
    recall: ratio(correct, labeled),
  };
}

function score(transcript, labels) {
  const marks = loadDelivery().classify(transcript);
  const result = {};
  for (const kind of KINDS) {
    const flagged = new Set();
    marks.forEach((mark, index) => {
      if (mark === kind) flagged.add(index);
    });
    const labeled = new Set((labels && labels[kind]) || []);
    const correct = [...flagged].filter((index) => labeled.has(index)).length;
    result[kind] = withRatios(flagged.size, labeled.size, correct);
  }
  return result;
}

function sumResults(results) {
  const total = {};
  for (const kind of KINDS) {
    const add = (key) => results.reduce((sum, result) => sum + result[kind][key], 0);
    total[kind] = withRatios(add("flagged"), add("labeled"), add("correct"));
  }
  return total;
}

function percent(value) {
  return value === null ? "-" : `${Math.round(value * 100)}%`;
}

const NAME_WIDTH = 24;
const COLUMN_WIDTH = 8;

function formatCells(name, cells) {
  const shown = name.length > NAME_WIDTH ? `${name.slice(0, NAME_WIDTH - 1)}~` : name;
  const columns = cells.map((cell) => String(cell).padStart(COLUMN_WIDTH));
  return shown.padEnd(NAME_WIDTH) + columns.join("");
}

function formatHeader() {
  return formatCells("take", ["hes P", "hes R", "habit P", "habit R", "missed"]);
}

function formatRow(name, result, missed) {
  const { hesitation, habit } = result;
  return formatCells(name, [
    percent(hesitation.precision),
    percent(hesitation.recall),
    percent(habit.precision),
    percent(habit.recall),
    missed,
  ]);
}

// Reads every *.json file in the folder. Throws an Error with a one-line message on trouble.
function readTakes(folder) {
  let files;
  try {
    files = fs.readdirSync(folder).filter((file) => file.endsWith(".json")).sort();
  } catch {
    throw new Error(`Cannot read folder: ${folder}`);
  }
  if (files.length === 0) throw new Error(`No .json files in ${folder}`);
  return files.map((file) => {
    let take;
    try {
      take = JSON.parse(fs.readFileSync(path.join(folder, file), "utf8"));
    } catch {
      throw new Error(`${file}: not valid JSON`);
    }
    if (!take || !Array.isArray(take.transcript)) {
      throw new Error(`${file}: "transcript" must be a list of words`);
    }
    return { name: take.name || file.replace(/\.json$/, ""), take };
  });
}

function run(folder) {
  const rows = readTakes(folder).map(({ name, take }) => ({
    name,
    result: score(take.transcript, take.labels),
    missed: Number(take.missed) || 0,
  }));
  const lines = [formatHeader()];
  for (const row of rows) lines.push(formatRow(row.name, row.result, row.missed));
  const missed = rows.reduce((sum, row) => sum + row.missed, 0);
  lines.push(formatRow("TOTAL", sumResults(rows.map((row) => row.result)), missed));
  return lines.join("\n");
}

function main(argv) {
  if (argv.length !== 1) {
    console.error("Usage: node scripts/measure_fillers.js <folder>");
    return 2;
  }
  try {
    console.log(run(argv[0]));
    return 0;
  } catch (error) {
    console.error(error.message);
    return 1;
  }
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { score, formatRow, formatHeader, sumResults };
