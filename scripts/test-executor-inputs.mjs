// Frontend executor input collection tests.
// Runs directly on Node 24 via --experimental-strip-types.

import assert from "node:assert/strict";
import { buildInputs } from "../src/routes/autodeploy/lib/inputs.ts";

const nodes = [
  { id: "n_start" },
  { id: "n_lf" },
  { id: "n_cp" },
  { id: "n_end" },
];

function makeConns() {
  return [
    { fromNode: "n_start", toNode: "n_lf" },
    { fromNode: "n_lf", toNode: "n_cp" },
    { fromNode: "n_cp", toNode: "n_end" },
  ];
}

let passed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ok  ${name}`);
    passed++;
  } catch (e) {
    console.error(`  FAIL  ${name}`);
    console.error(e);
    process.exitCode = 1;
  }
}

console.log("buildInputs:");

test("no upstream -> empty inputs", () => {
  const executed = new Set();
  const outputs = new Map();
  const inputs = buildInputs("n_lf", makeConns(), executed, outputs, nodes);
  assert.equal(inputs.length, 0);
});

test("start has no output recorded -> skip (treated as no upstream)", () => {
  const executed = new Set(["n_start"]);
  const outputs = new Map();
  const inputs = buildInputs("n_lf", makeConns(), executed, outputs, nodes);
  assert.equal(inputs.length, 0);
});

test("local_file ran -> compress receives real path (regression for empty path bug)", () => {
  const executed = new Set(["n_start", "n_lf"]);
  const outputs = new Map();
  outputs.set("n_lf", {
    kind: "file",
    path: "C:\\projects\\frontend\\index.html",
    size: 42,
    name: "index.html",
  });
  const inputs = buildInputs("n_cp", makeConns(), executed, outputs, nodes);
  assert.equal(inputs.length, 1);
  assert.deepEqual(inputs[0], {
    kind: "file",
    path: "C:\\projects\\frontend\\index.html",
    size: 42,
    name: "index.html",
  });
  assert.notEqual(inputs[0].path, "");
});

test("upstream not yet executed -> skip", () => {
  const executed = new Set();
  const outputs = new Map();
  outputs.set("n_lf", { kind: "file", path: "/x" });
  const inputs = buildInputs("n_cp", makeConns(), executed, outputs, nodes);
  assert.equal(inputs.length, 0);
});

test("two upstream branches -> both outputs in inputs", () => {
  const localNodes = [
    { id: "n_a" },
    { id: "n_b" },
    { id: "n_merge" },
  ];
  const conns = [
    { fromNode: "n_a", toNode: "n_merge" },
    { fromNode: "n_b", toNode: "n_merge" },
  ];
  const executed = new Set(["n_a", "n_b"]);
  const outputs = new Map();
  outputs.set("n_a", { kind: "file", path: "/a" });
  outputs.set("n_b", { kind: "file", path: "/b" });
  const inputs = buildInputs("n_merge", conns, executed, outputs, localNodes);
  assert.equal(inputs.length, 2);
  assert.equal(inputs[0].path, "/a");
  assert.equal(inputs[1].path, "/b");
});

test("upstream in executed but no recorded output -> skip", () => {
  const executed = new Set(["n_start"]);
  const outputs = new Map();
  const inputs = buildInputs("n_lf", makeConns(), executed, outputs, nodes);
  assert.equal(inputs.length, 0);
});

test("end node still receives upstream output like any other node", () => {
  // end 节点和普通节点一样收集 inputs，只是 executor 在调用前已经短路掉了
  const executed = new Set(["n_start", "n_lf", "n_cp"]);
  const outputs = new Map();
  outputs.set("n_cp", { kind: "file", path: "/z.zip" });
  const inputs = buildInputs("n_end", makeConns(), executed, outputs, nodes);
  assert.equal(inputs.length, 1);
  assert.equal(inputs[0].path, "/z.zip");
});

if (process.exitCode) {
  console.error(`\nFAILED`);
  process.exit(process.exitCode);
}
console.log(`\n${passed} passed`);
