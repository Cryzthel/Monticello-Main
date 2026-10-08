#!/usr/bin/env node
// Derives the Phase/Block/Lot export from the authoritative Dart source,
// so the export can never drift from what the app actually ships.
//
// Run from the repo root:
//
//   node scripts/export-subdivision-lots.js
//
// Writes db/exports/{subdivision-lots.json, subdivision-lots-flat.json,
// subdivision-lots.txt}. Override either path by passing them as arguments.
//
// It parses the Dart source rather than keeping a second copy of the schedule,
// and it fails rather than writes if the parsed totals stop matching the
// counts asserted in test/subdivision_directory_test.dart.

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const dartPath =
  process.argv[2] ||
  path.join(repoRoot, 'lib/features/property/data/subdivision_directory.dart');
const outDir = process.argv[3] || path.join(repoRoot, 'db/exports');

const src = fs.readFileSync(dartPath, 'utf8');

// Strip comments so prose mentioning "BlockSpec(2, [LotRun(1, 66)])" can't be
// mistaken for data. Block comments first, then line comments.
const code = src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split(/\r?\n/)
  .map((line) => line.replace(/\/\/.*$/, ''))
  .join('\n');

// Phase order is MapConstants.subdivisionPhases: ['1', '2', '3', '5'].
const PHASE_ORDER = ['1', '2', '3', '5'];

function sliceList(name) {
  // Grab `static const List<BlockSpec> _phaseN = [ ... ];`
  const re = new RegExp(
    'static\\s+const\\s+List<BlockSpec>\\s+' + name + '\\s*=\\s*\\[',
  );
  const m = re.exec(code);
  if (!m) throw new Error('could not find ' + name);
  let i = m.index + m[0].length;
  let depth = 1;
  const start = i;
  while (i < code.length && depth > 0) {
    const ch = code[i];
    if (ch === '[') depth++;
    else if (ch === ']') depth--;
    i++;
  }
  if (depth !== 0) throw new Error('unbalanced brackets in ' + name);
  return code.slice(start, i - 1);
}

function parsePhase(name) {
  const body = sliceList(name);
  const blocks = [];
  const specRe = /BlockSpec\(\s*(\d+)\s*,\s*\[/g;
  let m;
  while ((m = specRe.exec(body)) !== null) {
    const blockNo = Number(m[1]);
    // Walk to the matching close bracket of this spec's run list.
    let i = specRe.lastIndex;
    let depth = 1;
    const start = i;
    while (i < body.length && depth > 0) {
      const ch = body[i];
      if (ch === '[') depth++;
      else if (ch === ']') depth--;
      i++;
    }
    const runsSrc = body.slice(start, i - 1);
    const runs = [];
    const runRe = /LotRun\(\s*(\d+)\s*,\s*(\d+)\s*\)/g;
    let r;
    while ((r = runRe.exec(runsSrc)) !== null) {
      const first = Number(r[1]);
      const last = Number(r[2]);
      if (last < first) {
        throw new Error(`Block ${blockNo}: inverted run ${first}-${last}`);
      }
      runs.push([first, last]);
    }
    if (runs.length === 0) {
      throw new Error(`Block ${blockNo}: no LotRun entries parsed`);
    }
    // Runs must be ascending and non-overlapping, or the source is wrong.
    for (let k = 1; k < runs.length; k++) {
      if (runs[k][0] <= runs[k - 1][1]) {
        throw new Error(
          `Block ${blockNo}: run ${runs[k][0]}-${runs[k][1]} overlaps ` +
            `${runs[k - 1][0]}-${runs[k - 1][1]}`,
        );
      }
    }
    blocks.push({ block: blockNo, runs });
    specRe.lastIndex = i;
  }
  return blocks;
}

const phases = {};
for (const p of PHASE_ORDER) phases[p] = parsePhase('_phase' + p);

// ── Derive ──────────────────────────────────────────────────────────────────

const runCount = ([a, b]) => b - a + 1;
const runLabel = ([a, b]) => (a === b ? String(a) : `${a}-${b}`);
const lotsOf = (runs) => {
  const out = [];
  for (const [a, b] of runs) for (let l = a; l <= b; l++) out.push(l);
  return out;
};

const summary = {};
let grandTotal = 0;
for (const p of PHASE_ORDER) {
  let total = 0;
  for (const spec of phases[p]) {
    total += spec.runs.reduce((s, r) => s + runCount(r), 0);
  }
  summary[p] = { blocks: phases[p].length, lots: total };
  grandTotal += total;
}

// Cross-check against the counts asserted in test/subdivision_directory_test.dart.
const EXPECTED = { 1: 457, 2: 541, 3: 340, 5: 106 };
const EXPECTED_TOTAL = 1444;
const problems = [];
for (const p of PHASE_ORDER) {
  if (summary[p].lots !== EXPECTED[p]) {
    problems.push(`Phase ${p}: parsed ${summary[p].lots}, test says ${EXPECTED[p]}`);
  }
}
if (grandTotal !== EXPECTED_TOTAL) {
  problems.push(`total: parsed ${grandTotal}, test says ${EXPECTED_TOTAL}`);
}

console.log('Phase   Blocks   Lots');
for (const p of PHASE_ORDER) {
  console.log(
    `  ${p}       ${String(summary[p].blocks).padStart(2)}      ${String(summary[p].lots).padStart(4)}`,
  );
}
console.log(`TOTAL   ${String(PHASE_ORDER.reduce((s, p) => s + summary[p].blocks, 0)).padStart(2)}      ${grandTotal}`);

if (problems.length) {
  console.error('\nMISMATCH vs test assertions:');
  for (const line of problems) console.error('  - ' + line);
  process.exit(1);
}
console.log('\nMatches test/subdivision_directory_test.dart exactly.');

fs.mkdirSync(outDir, { recursive: true });

// ── 1. Structured JSON (runs + explicit lots) ───────────────────────────────

const json = {
  estate: 'Monticello Villas',
  source: 'lib/features/property/data/subdivision_directory.dart',
  generatedFrom: 'Pro-Friends site plans MV1, MV2, MV3, MV5',
  totals: { phases: PHASE_ORDER.length, lots: grandTotal },
  phases: PHASE_ORDER.map((p) => ({
    phase: p,
    planCode: 'MV' + p,
    blockCount: summary[p].blocks,
    lotCount: summary[p].lots,
    blocks: phases[p].map((spec) => ({
      block: spec.block,
      lotCount: spec.runs.reduce((s, r) => s + runCount(r), 0),
      hasGaps: spec.runs.length > 1,
      lotSummary: spec.runs.map(runLabel).join(', '),
      runs: spec.runs.map(([first, last]) => ({ first, last })),
      lots: lotsOf(spec.runs),
    })),
  })),
};
fs.writeFileSync(
  path.join(outDir, 'subdivision-lots.json'),
  JSON.stringify(json, null, 2) + '\n',
  'utf8',
);

// ── 2. Flat array of every address ──────────────────────────────────────────

const flat = [];
for (const p of PHASE_ORDER) {
  for (const spec of phases[p]) {
    for (const lot of lotsOf(spec.runs)) {
      flat.push({
        phase: p,
        block: spec.block,
        lot,
        label: `Phase ${p}, Block ${spec.block}, Lot ${lot}`,
        storageKey: `${p}/${spec.block}/${lot}`,
      });
    }
  }
}
if (flat.length !== grandTotal) {
  console.error(`flat list is ${flat.length}, expected ${grandTotal}`);
  process.exit(1);
}
fs.writeFileSync(
  path.join(outDir, 'subdivision-lots-flat.json'),
  JSON.stringify(flat, null, 2) + '\n',
  'utf8',
);

// ── 3. Plain-text hierarchy ─────────────────────────────────────────────────

const txt = [];
txt.push('MONTICELLO VILLAS — SUBDIVISION PROPERTY DIRECTORY');
txt.push('='.repeat(66));
txt.push('');
txt.push(`Phases: ${PHASE_ORDER.length} (1, 2, 3, 5 — there is no Phase 4)`);
txt.push(`Blocks: ${PHASE_ORDER.reduce((s, p) => s + summary[p].blocks, 0)}`);
txt.push(`Addressable lots: ${grandTotal}`);
txt.push('');
txt.push('Source: lib/features/property/data/subdivision_directory.dart');
txt.push('Lot runs are inclusive. Gaps are real — open space, easements, roads.');
txt.push('');
for (const p of PHASE_ORDER) {
  txt.push('-'.repeat(66));
  txt.push(
    `PHASE ${p}  (site plan MV${p})  —  ${summary[p].blocks} blocks, ${summary[p].lots} lots`,
  );
  txt.push('-'.repeat(66));
  const specs = phases[p];
  specs.forEach((spec, idx) => {
    const lastBlock = idx === specs.length - 1;
    const count = spec.runs.reduce((s, r) => s + runCount(r), 0);
    txt.push(
      `${lastBlock ? '└─' : '├─'} Block ${spec.block}  (${count} lot${count === 1 ? '' : 's'})`,
    );
    const stem = lastBlock ? '   ' : '│  ';
    txt.push(`${stem}└─ Lots: ${spec.runs.map(runLabel).join(', ')}`);
    if (spec.runs.length > 1) {
      const missing = [];
      for (let k = 1; k < spec.runs.length; k++) {
        const gapFrom = spec.runs[k - 1][1] + 1;
        const gapTo = spec.runs[k][0] - 1;
        missing.push(gapFrom === gapTo ? String(gapFrom) : `${gapFrom}-${gapTo}`);
      }
      txt.push(`${stem}   (not lots: ${missing.join(', ')})`);
    }
  });
  txt.push('');
}
fs.writeFileSync(path.join(outDir, 'subdivision-lots.txt'), txt.join('\n'), 'utf8');

console.log(`\nWrote 3 files to ${outDir}`);
console.log(`  subdivision-lots.json       hierarchical, ${PHASE_ORDER.length} phases`);
console.log(`  subdivision-lots-flat.json  ${flat.length} addresses`);
console.log(`  subdivision-lots.txt        plain-text tree`);
