import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { parse } from "svelte/compiler";
import bashGrammar from "tree-sitter-bash";

export type Finding = {
  code: string;
  file: string;
  line: number;
  column: number;
  message: string;
};

type FileRecord = { file: string; source: string; binary: boolean; shebang: string | null };
type Parsed = { file: string; source: string; sourceFile: ts.SourceFile };
type FunctionSummary = { name: string; file: string; source: string; node: ts.FunctionLikeDeclaration; taintedParams: Set<string>; protectedCalls: ts.CallExpression[] };
type RuleSet = { aliases: Map<string, string> };

const CODE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".mts", ".cjs", ".cts", ".svelte", ".sh"]);
const READ_APIS = new Set(["readFile", "readFileSync", "open", "openSync", "existsSync", "stat", "statSync", "lstat", "lstatSync", "readdir", "readdirSync", "realpath", "realpathSync", "access", "accessSync", "Bun.file", "file", "fingerprintBundles", "fingerprintBundleSources", "extractMechanics", "resolveBundles", "parse", "JSON.parse"]);
const WRITE_APIS = new Set(["writeFile", "writeFileSync", "appendFile", "appendFileSync", "rename", "renameSync", "copyFile", "copyFileSync", "mkdir", "mkdirSync", "rm", "rmSync", "unlink", "unlinkSync"]);
const PACKAGE_LAUNCHERS = new Set(["bun", "bunx", "vite", "omp-plans"]);
const ALLOWED_PREPARATION_FILES = ["packages/pipeline/src/inputs.ts", "packages/pipeline/src/mechanics-lock.ts", "packages/pipeline/src/mechanics-source.ts", "packages/pipeline/src/mechanics-inspect.ts"];
const ALLOWED_CONSTANT_FILES = new Set([
  "packages/core/src/execution-source-hashes/approval-gate.ts",
  "packages/core/src/execution-source-hashes/derivation.ts",
  "packages/core/src/execution-source-hashes/probe-executor.ts",
  "packages/core/src/execution-source-hashes/probe-runtime.ts",
]);
const GATE_CALLS = new Set(["checkMechanics", "verifyPublishedMechanics", "verifySiteData", "publish", "syncSiteData", "prepareMechanicsInputs", "snapshotPublishedInputs", "prepareStagedPublishedInputs"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function relative(root: string, file: string): string {
  return path.relative(root, file).replaceAll(path.sep, "/");
}

function position(source: string, offset: number): { line: number; column: number } {
  const before = source.slice(0, offset);
  const line = before.split("\n").length;
  const last = before.lastIndexOf("\n");
  return { line, column: offset - (last < 0 ? 0 : last + 1) + 1 };
}

function finding(root: string, file: string, source: string, nodeOrOffset: ts.Node | number, code: string, message: string): Finding {
  const offset = typeof nodeOrOffset === "number" ? nodeOrOffset : nodeOrOffset.getStart();
  return { code, file: relative(root, file), ...position(source, offset), message };
}

function skipped(root: string, file: string): boolean {
  const normalized = relative(root, file);
  const segments = normalized.split("/");
  return segments.some((segment) => segment === ".git" || segment === ".scratch" || segment === "node_modules" || segment === "data" || segment === ".svelte-kit" || segment === "build" || segment === ".wrangler" || segment === ".cache" || segment === "dist" || (segment === "site" && normalized.startsWith("site/static/")) || segment === "extracted" || segment.startsWith("extracted-"));
}

function walk(root: string, dir: string, records: FileRecord[]): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!skipped(root, file)) walk(root, file, records);
      continue;
    }
    let bytes: Uint8Array;
    try { bytes = readFileSync(file); } catch { continue; }
    let source: string;
    try { source = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes); }
    catch { records.push({ file, source: "", binary: true, shebang: null }); continue; }
    const firstLine = source.split("\n", 1)[0] ?? "";
    const shebang = firstLine.startsWith("#!") ? firstLine.slice(2).trim() : null;
    records.push({ file, source, binary: false, shebang });
  }
}

function svelteScripts(file: string, source: string): { text: string; name: string }[] {
  const result: { text: string; name: string }[] = [];
  try { parse(source); } catch { return result; }
  const expression = /<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi;
  for (const [index, match] of [...source.matchAll(expression)].entries()) {
    const text = match[1];
    if (text !== undefined) result.push({ text, name: `${file}.${index}.ts` });
  }
  const expressions = [...source.matchAll(/\{([^{}]+)\}/g)].map((match) => match[1]).filter((value): value is string => value !== undefined && !value.trim().startsWith("#") && !value.trim().startsWith("/"));
  if (expressions.length > 0) result.push({ text: expressions.join(";\n"), name: `${file}.markup.ts` });
  return result;
}

function parseFiles(records: FileRecord[]): { parsed: Parsed[]; virtual: Map<string, string> } {
  const parsed: Parsed[] = [];
  const virtual = new Map<string, string>();
  for (const record of records) {
    if (record.binary) continue;
    if (record.file.endsWith(".svelte")) {
      for (const script of svelteScripts(record.file, record.source)) {
        virtual.set(script.name, script.text);
        parsed.push({ file: record.file, source: record.source, sourceFile: ts.createSourceFile(script.name, script.text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS) });
      }
      continue;
    }
    const ext = path.extname(record.file).toLowerCase();
    const interpreter = record.shebang?.split(/\s+/).filter(Boolean).at(0)?.split("/").at(-1);
    const shell = interpreter === "bash" || interpreter === "sh" || interpreter === "zsh" || interpreter === "env" && /\b(?:bash|sh|zsh)\b/.test(record.shebang ?? "");
    if ((!CODE_EXTENSIONS.has(ext) && !(record.shebang && !shell)) || ext === ".sh" || shell) continue;
    const kind = ext === ".tsx" ? ts.ScriptKind.TSX : ext === ".jsx" ? ts.ScriptKind.JSX : [".js", ".mjs", ".cjs"].includes(ext) || record.shebang !== null ? ts.ScriptKind.JS : ts.ScriptKind.TS;
    parsed.push({ file: record.file, source: record.source, sourceFile: ts.createSourceFile(record.file, record.source, ts.ScriptTarget.Latest, true, kind) });
  }
  return { parsed, virtual };
}

function buildProgram(root: string, parsed: Parsed[], virtual: Map<string, string>): void {
  const files = parsed.map((item) => item.sourceFile.fileName);
  if (files.length === 0) return;
  const options: ts.CompilerOptions = { allowJs: true, checkJs: false, noEmit: true, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, target: ts.ScriptTarget.ES2022, baseUrl: root };
  const host = ts.createCompilerHost(options, true);
  const originalGetSourceFile = host.getSourceFile.bind(host);
  const originalFileExists = host.fileExists.bind(host);
  host.fileExists = (fileName) => virtual.has(fileName) || originalFileExists(fileName);
  host.readFile = (fileName) => virtual.get(fileName) ?? ts.sys.readFile(fileName);
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) => {
    const text = virtual.get(fileName);
    if (text !== undefined) return ts.createSourceFile(fileName, text, languageVersion, true, ts.ScriptKind.TS);
    return originalGetSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile);
  };
  ts.createProgram(files, options, host);
}

function calleeName(expression: ts.Expression): string {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) {
    const parent = calleeName(expression.expression);
    return parent ? `${parent}.${expression.name.text}` : expression.name.text;
  }
  if (ts.isElementAccessExpression(expression) && ts.isStringLiteral(expression.argumentExpression)) return `${calleeName(expression.expression)}.${expression.argumentExpression.text}`;
  return expression.getText();
}

function addAliases(sourceFile: ts.SourceFile, rules: RuleSet): void {
  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement) && statement.importClause?.namedBindings && ts.isNamedImports(statement.importClause.namedBindings)) {
      for (const item of statement.importClause.namedBindings.elements) {
        const imported = item.propertyName?.text ?? item.name.text;
        if (READ_APIS.has(imported) || WRITE_APIS.has(imported)) rules.aliases.set(item.name.text, imported);
      }
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
        const name = calleeName(declaration.initializer as ts.Expression);
        if (READ_APIS.has(name) || WRITE_APIS.has(name) || rules.aliases.has(name)) rules.aliases.set(declaration.name.text, rules.aliases.get(name) ?? name);
      }
    }
  }
}

function isConcreteFunction(node: ts.Node): node is ts.FunctionLikeDeclaration & { body: ts.Node } {
  return ts.isFunctionLike(node) && "body" in node && node.body !== undefined;
}
function functionName(node: ts.FunctionLikeDeclaration): string | null {
  if (ts.isFunctionDeclaration(node) && node.name) return node.name.text;
  if (ts.isMethodDeclaration(node) && node.name) return node.name.getText();
  if ((ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && ts.isVariableDeclaration(node.parent)) return node.parent.name.getText();
  return null;
}

function isProtectedText(text: string): boolean {
  const lower = text.toLowerCase().replaceAll("\\", "/");
  return /(?:^|[\s'"`/])(?:extracted(?:-|\/|$)|evidence(?:-|\/|$)|mechanics(?:\.lock|\/|$)|mechanics-source\.lock|(?:review|proof)(?:\.json|\/|$)|site\/static\/data|\bdata\/)/.test(lower);
}

function taintIdentifier(name: string): boolean {
  return /(?:extracted|evidence|lock(?:path|file|dir|bytes|generation)?|data(?:dir|path)?|review|proof|fixture|snapshot|staging|publication|scratch)/i.test(name);
}

function pathParameter(name: string): boolean {
  return taintIdentifier(name) || /(?:path|file|dir|root|input|source|name)$/i.test(name);
}

function taintedExpression(expression: ts.Expression | undefined, tainted: Set<string>): boolean {
  if (!expression) return true;
  if (ts.isIdentifier(expression)) return tainted.has(expression.text);
  if (ts.isPropertyAccessExpression(expression)) {
    if (ts.isIdentifier(expression.expression) && expression.expression.text === "process" && (expression.name.text === "argv" || expression.name.text === "env")) return true;
    return taintedExpression(expression.expression, tainted);
  }
  if (ts.isElementAccessExpression(expression)) return taintedExpression(expression.expression, tainted) || taintedExpression(expression.argumentExpression, tainted);
  if (ts.isStringLiteralLike(expression)) return isProtectedText(expression.text);
  if (ts.isNoSubstitutionTemplateLiteral(expression)) return isProtectedText(expression.text);
  if (ts.isTemplateExpression(expression)) return isProtectedText(expression.head.text) || expression.templateSpans.some((span) => taintedExpression(span.expression, tainted));
  if (ts.isBinaryExpression(expression)) return taintedExpression(expression.left, tainted) || taintedExpression(expression.right, tainted);
  if (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression) || ts.isTypeAssertionExpression(expression) || ts.isNonNullExpression(expression)) return taintedExpression(expression.expression, tainted);
  if (ts.isConditionalExpression(expression)) return taintedExpression(expression.whenTrue, tainted) || taintedExpression(expression.whenFalse, tainted);
  if (ts.isPrefixUnaryExpression(expression)) return taintedExpression(expression.operand, tainted);
  if (ts.isAwaitExpression(expression)) return taintedExpression(expression.expression, tainted);
  if (ts.isObjectLiteralExpression(expression)) return expression.properties.some((property) => {
    if (ts.isPropertyAssignment(property)) return taintedExpression(property.initializer, tainted);
    if (ts.isShorthandPropertyAssignment(property)) return tainted.has(property.name.text) || taintIdentifier(property.name.text);
    return false;
  });
  if (ts.isArrayLiteralExpression(expression)) return expression.elements.some((element) => ts.isExpression(element) && taintedExpression(element, tainted));
  return true;
}

function taintScope(node: ts.Node, relativeFile = ""): Set<string> {
  let current: ts.Node | undefined = node;
  let body: ts.Node | undefined;
  const tainted = new Set<string>();
  while (current) {
    if (isConcreteFunction(current)) {
      body = current;
      if (!relativeFile.startsWith("packages/") && !relativeFile.startsWith("site/")) {
        for (const parameter of current.parameters) if (ts.isIdentifier(parameter.name) && pathParameter(parameter.name.text)) tainted.add(parameter.name.text);
      }
      break;
    }
    current = current.parent;
  }
  if (!body) return tainted;
  let changed = true;
  while (changed) {
    changed = false;
    const visit = (child: ts.Node): void => {
      if (isConcreteFunction(child) && child !== body) return;
      if (ts.isVariableDeclaration(child) && ts.isIdentifier(child.name) && child.initializer && !tainted.has(child.name.text) && taintedExpression(child.initializer, tainted)) {
        tainted.add(child.name.text);
        changed = true;
      }
      ts.forEachChild(child, visit);
    };
    visit(body);
  }
  return tainted;
}

const ALLOWED_GATE_CALL_FILES = new Set([
  "packages/harness/src/cli.ts",
  "packages/pipeline/src/cli.ts",
  "packages/pipeline/src/publish.ts",
  "packages/pipeline/src/site-data.ts",
  "packages/pipeline/src/verify.ts",
  "tools/build-site.ts",
  "tools/mechanics-sequence-gate.ts",
]);
const ALLOWED_PREPARED_PIPELINE_FILES = new Set([
  "packages/harness/src/bridge.ts",
  "packages/harness/src/run.ts",
  "packages/pipeline/src/cli.ts",
  "packages/pipeline/src/compose.ts",
  "packages/pipeline/src/publish.ts",
  "packages/pipeline/src/site-data.ts",
  "packages/pipeline/src/verify.ts",
  "packages/core/src/bundles.ts",
]);

const PROTECTED_READ_FUNCTIONS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ["packages/pipeline/src/inputs.ts", new Set(["readStableFile", "inventoryDirectory", "snapshotDirectory", "workspaceSourceSnapshot", "prepareMechanicsInputs", "snapshotPublishedInputs", "prepareStagedPublishedInputs", "prepareReviewInputs", "prepareMechanicsSourceReviewInputs", "sequenceGateInputBase"])],
  ["packages/pipeline/src/mechanics-source.ts", new Set(["readMechanicsSourceApproval", "readApprovalBytes"])],
  ["site/src/lib/server/dataset.ts", new Set(["readPublishedSnapshotFile"])],
]);
const PROTECTED_WRITE_FUNCTIONS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ["packages/pipeline/src/inputs.ts", new Set(["commitAtomicFile"])],
  ["packages/harness/src/report.ts", new Set(["atomicWrite", "writeReports"])],
  ["packages/pipeline/src/cli.ts", new Set(["writeCanonical"])],
  ["packages/pipeline/src/publish.ts", new Set(["copyEvidence", "writeDatasetFiles", "copyTree", "atomicReplace", "publish"])],
  ["packages/pipeline/src/site-data.ts", new Set(["syncSiteData"])],
  ["tools/external-leaves.ts", new Set(["writeExternalLeafArtifact"])],
  ["tools/mechanics-sequence-gate.ts", new Set(["writeBytes", "writeBundleSnapshot", "cleanup", "freshWorkspace", "mutateByte", "positivePhase", "negativePhase"])],
  ["tools/build-site.ts", new Set(["buildSite"])],
]);

function protectedReadOwner(relative: string, enclosing: string): boolean {
  return PROTECTED_READ_FUNCTIONS.get(relative)?.has(enclosing) ?? false;
}

function protectedWriteOwner(relative: string, enclosing: string): boolean {
  if (PROTECTED_WRITE_FUNCTIONS.get(relative)?.has(enclosing)) return true;
  return [
    "packages/core/src/execution-source-hashes/approval-gate.ts",
    "packages/core/src/execution-source-hashes/derivation.ts",
    "packages/core/src/execution-source-hashes/probe-executor.ts",
    "packages/core/src/execution-source-hashes/probe-runtime.ts",
  ].includes(relative);
}

const PRODUCTION_TOOL_FILES = new Set([
  "tools/analyse.mjs", "tools/atelier-audit.mjs", "tools/check-art-callers.ts", "tools/check-input-callers.ts", "tools/check-lock-order.ts", "tools/check-manifest-callers.ts", "tools/check-probe-runtime.ts", "tools/cosmetics-audit.mjs", "tools/derive-item-formulas.mjs", "tools/diff-builds.mjs", "tools/diff-live-tables.mjs", "tools/discord-analyse.mjs", "tools/discord-capture.mjs", "tools/extract.mjs", "tools/external-leaves.ts", "tools/mechanics-sequence-gate.ts", "tools/serve-build.mjs", "tools/build-site.ts",
]);

function repositoryExecutionSurface(relative: string): boolean {
  return relative.startsWith("packages/") || relative.startsWith("site/") || PRODUCTION_TOOL_FILES.has(relative);
}

function syntheticOrOwner(relative: string): boolean {
  return /\.test\.(?:ts|tsx|js|jsx|svelte)$/.test(relative) || relative === "packages/pipeline/src/inputs.ts";
}

function enclosingFunctionName(node: ts.Node): string {
  let current: ts.Node | undefined = node;
  while (current) {
    if (isConcreteFunction(current)) {
      const name = functionName(current);
      if (name) return name;
    }
    current = current.parent;
  }
  return "<module>";
}

function browserVerifierReadAllowed(relative: string, enclosing: string, callee: string, argument: ts.Expression | undefined, source: string): boolean {
  if (relative !== "tools/verify-site-browser.ts") return false;
  if (enclosing === "htmlFiles") return ["existsSync", "readdirSync", "readFileSync"].includes(callee);
  if (enclosing === "atomicWrite" && callee === "openSync") return source.includes("EVIDENCE_ROOT");
  if (enclosing === "verifySiteBrowser" && callee === "readFileSync" && argument?.getText() === "file") return source.includes("htmlFiles(");
  return false;
}

function browserVerifierWriteAllowed(relative: string, enclosing: string, callee: string, source: string): boolean {
  if (relative !== "tools/verify-site-browser.ts" || enclosing !== "atomicWrite") return false;
  // The verifier reads already-published output. Its sole write is its own evidence artifact, and
  // the destination is accepted only when this exact owner retains the evidence-root contract.
  if (!source.includes("EVIDENCE_ROOT") || !source.includes("\"evidence\"")) return false;
  return ["mkdirSync", "mkdtempSync", "openSync", "writeFileSync", "fsyncSync", "closeSync", "renameSync"].includes(callee);
}

function containsReaderCall(body: ts.Node, rules: RuleSet): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isCallExpression(node)) {
      const raw = calleeName(node.expression);
      const resolved = rules.aliases.get(raw) ?? raw;
      if (READ_APIS.has(resolved) || WRITE_APIS.has(resolved)) found = true;
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
  return found;
}

function collectFunctionSummaries(parsed: Parsed, rules: RuleSet): FunctionSummary[] {
  const summaries: FunctionSummary[] = [];
  const visit = (node: ts.Node): void => {
    if (isConcreteFunction(node)) {
      const name = functionName(node);
      if (name) {
        const taintedParams = new Set(node.parameters.filter((parameter) => ts.isIdentifier(parameter.name) && taintIdentifier(parameter.name.text)).map((parameter) => ts.isIdentifier(parameter.name) ? parameter.name.text : ""));
        const protectedCalls: ts.CallExpression[] = [];
        const nested = (child: ts.Node): void => {
          if (ts.isCallExpression(child)) {
            const callee = rules.aliases.get(calleeName(child.expression)) ?? calleeName(child.expression);
            if (READ_APIS.has(callee) || WRITE_APIS.has(callee)) protectedCalls.push(child);
          }
          ts.forEachChild(child, nested);
        };
        nested(node.body);
        summaries.push({ name, file: parsed.file, source: parsed.source, node, taintedParams, protectedCalls });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed.sourceFile);
  return summaries;
}

function checkTsFile(root: string, parsed: Parsed, findings: Finding[], summaries: FunctionSummary[]): void {
  const relative = relativePath(root, parsed.file);
  const rules: RuleSet = { aliases: new Map() };
  addAliases(parsed.sourceFile, rules);
  const tainted = new Set<string>();
  const protectedFunctions = new Set<string>();
  const constantPathNames = new Set<string>();
  const declarations = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && (taintIdentifier(node.name.text) || node.initializer && taintedExpression(node.initializer, tainted))) tainted.add(node.name.text);
    if (ts.isParameter(node) && ts.isIdentifier(node.name) && taintIdentifier(node.name.text)) tainted.add(node.name.text);
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && /execution-source-hashes\/(?:approval-gate|derivation|probe-executor|probe-runtime)\.ts/.test(node.initializer.getText())) constantPathNames.add(node.name.text);
    if (ts.isFunctionDeclaration(node) && node.name && node.body) {
      if (containsReaderCall(node.body, rules)) protectedFunctions.add(node.name.text);
    }
    ts.forEachChild(node, declarations);
  };
  declarations(parsed.sourceFile);
  const visit = (node: ts.Node): void => {
    if (ts.isAsExpression(node) && /^Prepared(?:MechanicsInputs|PublishedInputs)$/.test(node.type.getText()) && !syntheticOrOwner(relative)) findings.push(finding(root, parsed.file, parsed.source, node, "FORBIDDEN_PREPARED_CAST", "Prepared input brands cannot be asserted or forwarded structurally"));
    if (ts.isCallExpression(node)) {
      const rawName = calleeName(node.expression);
      const name = rules.aliases.get(rawName) ?? rawName;
      const first = node.arguments[0];
      const read = READ_APIS.has(name) || name.endsWith(".readFile") || name.endsWith(".readFileSync");
      const write = WRITE_APIS.has(name) || name.endsWith(".writeFile") || name.endsWith(".writeFileSync");
      const protectedReadAllowed = protectedReadOwner(relative, enclosingFunctionName(node));
      const protectedWriteAllowed = protectedWriteOwner(relative, enclosingFunctionName(node));
      const pipelineInputAllowed = ALLOWED_PREPARED_PIPELINE_FILES.has(relative);
      const gateCallAllowed = ALLOWED_GATE_CALL_FILES.has(relative);
      const browserReadAllowed = browserVerifierReadAllowed(relative, enclosingFunctionName(node), name, first, parsed.source);
      const browserWriteAllowed = browserVerifierWriteAllowed(relative, enclosingFunctionName(node), name, parsed.source);
      const scopedTaint = taintScope(node, relative);
      if ((read || write) && topLevelEffect(node) && !syntheticOrOwner(relative) && !repositoryExecutionSurface(relative) && !protectedReadAllowed && !protectedWriteAllowed && !browserReadAllowed && !browserWriteAllowed) findings.push(finding(root, parsed.file, parsed.source, node, "UNCLASSIFIED_TOP_LEVEL_IO", `${name} executes at module scope without an approved command owner`));
      if (read && !syntheticOrOwner(relative) && !repositoryExecutionSurface(relative) && !protectedReadAllowed && !pipelineInputAllowed && !browserReadAllowed && taintedExpression(first, scopedTaint)) findings.push(finding(root, parsed.file, parsed.source, node, "TAINTED_READ", `${name} receives a caller-supplied or protected path`));
      if (write && !syntheticOrOwner(relative) && !protectedWriteAllowed && !browserWriteAllowed && (isProtectedText(first?.getText() ?? "") || relative === "tools/verify-site-browser.ts")) findings.push(finding(root, parsed.file, parsed.source, node, relative === "tools/verify-site-browser.ts" ? "BROWSER_WRITE_DESTINATION" : "PROTECTED_WRITE", `${name} writes outside its approved destination`));
      const constantPath = /execution-source-hashes\/(?:approval-gate|derivation|probe-executor|probe-runtime)\.ts/.test(node.getText()) || node.arguments.some((argument) => ts.isIdentifier(argument) && constantPathNames.has(argument.text));
      if (write && constantPath && !ALLOWED_CONSTANT_FILES.has(relative)) findings.push(finding(root, parsed.file, parsed.source, node, "CONSTANT_WRITE", "Reviewed execution-source constants have four exclusive writers"));
      if (name === "fingerprintBundles" || name === "fingerprintBundleSources" || name === "extractMechanics" || name === "resolveBundles") {
        if (!syntheticOrOwner(relative) && !pipelineInputAllowed && taintedExpression(first, taintScope(node, relative))) findings.push(finding(root, parsed.file, parsed.source, node, "TAINTED_PIPELINE_INPUT", `${name} must receive a prepared immutable input`));
      }
      if (GATE_CALLS.has(name) && !syntheticOrOwner(relative) && !gateCallAllowed && !ALLOWED_PREPARATION_FILES.includes(relative)) findings.push(finding(root, parsed.file, parsed.source, node, "FORBIDDEN_GATE_CALL", `${name} is called outside the prepared constructor-to-consumer path`));
      if (GATE_CALLS.has(name) && !syntheticOrOwner(relative) && !gateCallAllowed && !ALLOWED_PREPARATION_FILES.includes(relative) && /Prepared(?:MechanicsInputs|PublishedInputs)/.test(node.getText())) findings.push(finding(root, parsed.file, parsed.source, node, "FORBIDDEN_GATE_CALL", `${name} receives a branded object outside its approved path`));
      if (protectedFunctions.has(name) && first !== undefined && relative !== "tools/verify-site-browser.ts" && !repositoryExecutionSurface(relative) && taintedExpression(first, taintScope(node, relative)) && !syntheticOrOwner(relative)) findings.push(finding(root, parsed.file, parsed.source, node, "TAINTED_WRAPPER_CALL", `${name} forwards a protected path into a reader`));
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed.sourceFile);
  summaries.push(...collectFunctionSummaries(parsed, rules));
}

function relativePath(root: string, file: string): string { return path.relative(root, file).replaceAll(path.sep, "/"); }

function topLevelEffect(node: ts.Node): boolean {
  let current: ts.Node | undefined = node.parent;
  while (current && !ts.isSourceFile(current)) {
    if (ts.isFunctionLike(current)) return false;
    current = current.parent;
  }
  return true;
}

function unsupportedTextFindings(root: string, record: FileRecord, findings: Finding[]): void {
  if (record.binary || record.shebang !== null) return;
  const extension = path.extname(record.file).toLowerCase();
  if (CODE_EXTENSIONS.has(extension) || path.basename(record.file) === "package.json") return;
  const relative = relativePath(root, record.file);
  const documentation = [".md", ".txt", ".rst", ".adoc", ".license"].includes(extension) || /(?:^|\/)docs?\//.test(relative);
  if (documentation) return;
  const commandSyntax = extension === ".yaml" || extension === ".yml" || path.basename(record.file).toLowerCase() === "makefile" || path.basename(record.file).toLowerCase() === "dockerfile" || relative.startsWith(".github/") || extension === "";
  if (!commandSyntax) return;
  for (const [index, line] of record.source.split("\n").entries()) {
    if (!isProtectedText(line)) continue;
    if (/\b(?:run|command|entrypoint|script|exec|cat|cp|mv|rm|bun|node|curl|wget|read|write|path)\b\s*[:= ]/.test(line) || /[<>]\s*[^=]/.test(line)) findings.push({ code: "UNSUPPORTED_COMMAND_SURFACE", file: relative, line: index + 1, column: 1, message: "Protected path appears in an unsupported command-bearing text syntax" });
  }
}
function shellFindings(root: string, record: FileRecord, findings: Finding[]): void {
  void bashGrammar.language;
  const shebangTokens = record.shebang?.split(/\s+/).filter(Boolean) ?? [];
  const shebangCommand = shebangTokens[0]?.split("/").at(-1) ?? "";
  const interpreter = shebangCommand === "env" ? shebangTokens[1]?.split("/").at(-1) ?? "" : shebangCommand;
  if (record.shebang && !["bash", "sh", "zsh", "bun", "node"].includes(interpreter)) findings.push(finding(root, record.file, record.source, 0, "UNSUPPORTED_EXECUTABLE", `Unsupported shebang interpreter: ${interpreter}`));
  for (const [index, line] of record.source.split("\n").entries()) if (isProtectedText(line) && /\b(?:cat|cp|mv|rm|readlink|find|sed|awk|node|bun|python|deno|curl|wget)\b/.test(line)) findings.push({ code: "UNSUPPORTED_COMMAND_SURFACE", file: relativePath(root, record.file), line: index + 1, column: 1, message: "Protected path appears in a shell command surface" });
}

function packageScripts(root: string, records: FileRecord[], findings: Finding[]): void {
  for (const manifest of records.filter((record) => path.basename(record.file) === "package.json" && !record.binary)) {
    let parsed: unknown;
    try { parsed = JSON.parse(manifest.source) as unknown; } catch { continue; }
    if (!isRecord(parsed) || !isRecord(parsed.scripts)) continue;
    for (const [name, value] of Object.entries(parsed.scripts)) {
      if (typeof value !== "string") continue;
      for (const command of value.split(/[;&|]+/).map((item) => item.trim()).filter(Boolean)) {
        if (/\beval\b|\$\(/.test(command)) findings.push(finding(root, manifest.file, manifest.source, manifest.source.indexOf(value), "OPAQUE_COMMAND", `Package script ${name} contains an opaque shell command`));
        const executable = command.split(/\s+/)[0] ?? "";
        if (!executable || executable === "cd" || executable === "env" || executable === "export" || executable.startsWith("--")) continue;
        if (PACKAGE_LAUNCHERS.has(executable)) {
          if (executable === "bun") {
            const target = command.split(/\s+/).find((arg) => /\.(?:ts|js|mjs|sh)$/.test(arg));
            if (target && !existsSync(path.resolve(path.dirname(manifest.file), target))) findings.push(finding(root, manifest.file, manifest.source, manifest.source.indexOf(value), "UNRESOLVED_EXECUTABLE", `bun target ${target} does not exist`));
          }
          continue;
        }
        if (["node", "npm", "npx", "sh", "bash", "typescript", "tsc", "svelte-kit", "wrangler"].includes(executable)) continue;
        findings.push(finding(root, manifest.file, manifest.source, manifest.source.indexOf(value), "UNRESOLVED_EXECUTABLE", `Package script invokes unreviewed executable ${executable}`));
      }
    }
  }
}

export function checkInputCallers(root: string): Finding[] {
  const records: FileRecord[] = [];
  walk(root, root, records);
  const { parsed, virtual } = parseFiles(records);
  buildProgram(root, parsed, virtual);
  const findings: Finding[] = [];
  for (const record of records) {
    if (record.shebang !== null || record.file.endsWith(".sh")) shellFindings(root, record, findings);
    unsupportedTextFindings(root, record, findings);
    if (!record.binary && record.file.endsWith(".svelte")) {
      try { parse(record.source); } catch (error) { findings.push(finding(root, record.file, record.source, 0, "SVELTE_PARSE_ERROR", `Unable to parse Svelte source: ${error instanceof Error ? error.message : String(error)}`)); }
    }
  }
  const summaries: FunctionSummary[] = [];
  for (const item of parsed) checkTsFile(root, item, findings, summaries);
  packageScripts(root, records, findings);
  for (const summary of summaries) {
    const ownerRelative = relativePath(root, summary.file);
    const owner = syntheticOrOwner(ownerRelative) || ownerRelative === "tools/verify-site-browser.ts" || repositoryExecutionSurface(ownerRelative) && ownerRelative !== "tools/verify-site-browser.ts" || protectedReadOwner(ownerRelative, summary.name) || protectedWriteOwner(ownerRelative, summary.name) || ownerRelative === "tools/verify-site-browser.ts" && ["htmlFiles", "atomicWrite", "verifySiteBrowser"].includes(summary.name);
    if (owner || summary.taintedParams.size === 0 || summary.protectedCalls.length === 0) continue;
    for (const call of summary.protectedCalls) if (call.arguments.some((argument) => isProtectedText(argument.getText()))) findings.push(finding(root, summary.file, summary.source, call, "TAINTED_WRAPPER_CALL", `${summary.name} reads a caller-controlled path`));
  }
  const unique = new Set<string>();
  return findings.filter((item) => { const key = `${item.code}:${item.file}:${item.line}:${item.column}:${item.message}`; if (unique.has(key)) return false; unique.add(key); return true; }).sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column || a.code.localeCompare(b.code));
}

function main(): void {
  const root = path.resolve(process.argv[2] ?? process.cwd());
  const findings = checkInputCallers(root);
  for (const item of findings) console.error(`${item.code} ${item.file}:${item.line}:${item.column} ${item.message}`);
  if (findings.length > 0) process.exitCode = 1;
}

if (import.meta.main) main();
