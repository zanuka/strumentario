import path from "node:path";
import { fileURLToPath } from "node:url";

/** One TypeScript diagnostic, located in the file it was reported against. */
export interface TypeCheckDiagnostic {
  /** The absolute path the source was registered under; empty for a diagnostic that belongs to no file. */
  file: string;
  /** 1-based line, when the diagnostic points at one. */
  line?: number;
  /** The `TS####` code, e.g. `TS2304`. */
  code: string;
  message: string;
}

/**
 * Directory virtual sources are placed under so bare imports (the MCP SDK) resolve through this
 * package's node_modules. Nothing is ever written there.
 */
export const VIRTUAL_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "__virtual__");

/**
 * Type-check in-memory sources under the strict compiler options the scaffolded client is held to.
 * The scaffold tests and the `repair` tool both call this, so a repair is judged by the same
 * check as the output it repairs. `typescript` is loaded on first use, never at server start.
 *
 * Keys are absolute paths; they need not exist on disk.
 */
export async function typeCheckSources(sources: ReadonlyMap<string, string>): Promise<TypeCheckDiagnostic[]> {
  if (sources.size === 0) {
    return [];
  }
  const ts = (await import("typescript")).default;
  const options: import("typescript").CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    lib: ["lib.es2022.d.ts"],
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    strict: true,
    noUncheckedIndexedAccess: true,
    exactOptionalPropertyTypes: true,
    verbatimModuleSyntax: true,
    skipLibCheck: true,
    noEmit: true,
    types: [],
  };
  const host = ts.createCompilerHost(options);
  const { fileExists, readFile, getSourceFile, directoryExists } = host;
  const virtualDirs = new Set([...sources.keys()].map((file) => path.dirname(file)));
  host.directoryExists = (dir) => virtualDirs.has(dir) || (directoryExists?.call(host, dir) ?? false);
  host.fileExists = (file) => sources.has(file) || fileExists.call(host, file);
  host.readFile = (file) => sources.get(file) ?? readFile.call(host, file);
  host.getSourceFile = (file, languageVersion, onError) => {
    const source = sources.get(file);
    return source === undefined
      ? getSourceFile.call(host, file, languageVersion, onError)
      : ts.createSourceFile(file, source, languageVersion, true);
  };
  const program = ts.createProgram([...sources.keys()], options, host);
  return ts.getPreEmitDiagnostics(program).map((diagnostic) => {
    const start = diagnostic.file !== undefined && diagnostic.start !== undefined ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start) : undefined;
    return {
      file: diagnostic.file?.fileName ?? "",
      ...(start ? { line: start.line + 1 } : {}),
      code: `TS${diagnostic.code}`,
      message: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
    };
  });
}
