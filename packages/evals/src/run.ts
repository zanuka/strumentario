import { checkEvalGate } from "./index.js";

const result = checkEvalGate();
const stream = result.ok ? process.stdout : process.stderr;
stream.write(`${result.message}\n`);
process.exitCode = result.ok ? 0 : 1;
