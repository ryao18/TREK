import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const expected = readFileSync(path.join(__dirname, "VERSION"), "utf8").trim();

function fail(message) {
  console.error(message);
  process.exit(1);
}

let stdout = "";

try {
  stdout = execFileSync("bombadil", ["--version"], { encoding: "utf8" }).trim();
} catch (error) {
  fail("Bombadil CLI is not installed or not on PATH. Expected version " + expected + ".");
}

if (!stdout.includes(expected)) {
  fail(`Bombadil version mismatch. Expected ${expected}, got: ${stdout}`);
}

console.log(`Bombadil version verified: ${stdout}`);
