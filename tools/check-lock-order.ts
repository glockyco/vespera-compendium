import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

export type Finding = {
  code: string;
  file: string;
  line: number;
  column: number;
  message: string;
};

type LockKind = "mechanics-source" | "mechanics" | "site-data";
type LockRank = 1 | 2 | 3;
type Module = { file: string; source: string; sourceFile: ts.SourceFile };
type ImportTarget = { file: string; symbol: string } | { file: string; namespace: true };
type FunctionRecord = { file: string; source: string; name: string; node: ts.FunctionLikeDeclaration & { body: ts.Node }; calls: ts.CallExpression[] };
type Acquisition = { ranks: LockRank[]; unresolved: boolean } | null;

const EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".mts", ".cjs", ".cts"]);
const SKIP_DIRS = new Set(["node_modules", "extracted", "data", "site/static", ".svelte-kit", "build", ".wrangler"]);
const KINDS: Record<LockKind, LockRank> = { "mechanics-source": 1, mechanics: 2, "site-data": 3 };
const INPUTS_RELATIVE = "packages/pipeline/src/inputs.ts";

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

function finding(root: string, file: string, source: string, node: ts.Node, message: string, code = "LOCK_ORDER"): Finding {
  return { code, file: relative(root, file), ...position(source, node.getStart()), message };
}

function skipped(relativeFile: string): boolean {
  return relativeFile.split("/").some((segment) => SKIP_DIRS.has(segment) || segment.startsWith("extracted-"));
}

function walk(root: string, dir: string, files: string[]): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const file = path.join(dir, entry.name);
    const rel = relative(root, file);
    if (entry.isDirectory()) {
      if (!skipped(rel)) walk(root, file, files);
    } else if (EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      files.push(file);
    }
  }
}

function parseFile(file: string, source: string): ts.SourceFile {
  const ext = path.extname(file).toLowerCase();
  const kind = ext === ".tsx" ? ts.ScriptKind.TSX : ext === ".jsx" ? ts.ScriptKind.JSX : [".js", ".mjs", ".cjs"].includes(ext) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  return ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind);
}

function concreteFunction(node: ts.Node): node is ts.FunctionLikeDeclaration & { body: ts.Node } {
  return ts.isFunctionLike(node) && "body" in node && node.body !== undefined;
}

function functionName(node: ts.FunctionLikeDeclaration): string | null {
  if (ts.isFunctionDeclaration(node) && node.name) return node.name.text;
  if (ts.isMethodDeclaration(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)) return node.name?.getText() ?? null;
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
    const parent = node.parent;
    if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) return parent.name.text;
    if (ts.isPropertyAssignment(parent) && ts.isIdentifier(parent.name)) return parent.name.text;
  }
  return null;
}

function unwrap(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (ts.isParenthesizedExpression(current) || ts.isAsExpression(current) || ts.isTypeAssertionExpression(current)) current = current.expression;
  return current;
}

function resolveFile(root: string, importer: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith(".")) base = path.resolve(path.dirname(importer), specifier);
  else if (specifier === "@vespera/pipeline" || specifier === "@vespera/pipeline/") base = path.join(root, "packages/pipeline/src/index");
  else if (specifier.startsWith("@vespera/pipeline/")) base = path.join(root, "packages/pipeline/src", specifier.slice("@vespera/pipeline/".length));
  else return null;
  const candidates = [base, ...[...EXTENSIONS].map((ext) => `${base}${ext}`), ...[...EXTENSIONS].map((ext) => path.join(base, `index${ext}`))];
  return candidates.find((candidate) => {
    try { return readFileSync(candidate).length >= 0; } catch { return false; }
  }) ?? null;
}

function importedTargets(root: string, module: Module): Map<string, ImportTarget> {
  const result = new Map<string, ImportTarget>();
  for (const statement of module.sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !statement.importClause || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const target = resolveFile(root, module.file, statement.moduleSpecifier.text);
    if (!target) continue;
    const bindings = statement.importClause.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) result.set(bindings.name.text, { file: target, namespace: true });
    if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) result.set(element.name.text, { file: target, symbol: element.propertyName?.text ?? element.name.text });
    }
    if (statement.importClause.name) result.set(statement.importClause.name.text, { file: target, symbol: "default" });
  }
  return result;
}

function exported(statement: ts.Node): boolean {
  return ts.getModifiers(statement)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false;
}

function exportTarget(root: string, modules: Map<string, Module>, file: string, symbol: string, active = new Set<string>()): ImportTarget | null {
  const key = `${file}#${symbol}`;
  if (active.has(key)) return null;
  const next = new Set(active).add(key);
  if (relative(root, file) === INPUTS_RELATIVE && (symbol === "acquireLease" || symbol === "acquireLeases")) return { file, symbol };
  const module = modules.get(file);
  if (!module) return null;
  for (const statement of module.sourceFile.statements) {
    if (ts.isExportDeclaration(statement) && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
      const target = resolveFile(root, file, statement.moduleSpecifier.text);
      if (!target) continue;
      if (!statement.exportClause) {
        const resolved = exportTarget(root, modules, target, symbol, next);
        if (resolved) return resolved;
      } else if (ts.isNamedExports(statement.exportClause)) {
        const item = statement.exportClause.elements.find((entry) => entry.name.text === symbol);
        if (item) {
          const resolved = exportTarget(root, modules, target, item.propertyName?.text ?? item.name.text, next);
          if (resolved) return resolved;
        }
      }
    }
    if (ts.isExportAssignment(statement)) continue;
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === symbol && exported(statement)) return { file, symbol };
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || declaration.name.text !== symbol) continue;
        if (statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) return { file, symbol };
      }
    }
    if (ts.isTypeAliasDeclaration(statement) || ts.isInterfaceDeclaration(statement)) continue;
  }
  return null;
}

function resolveCallTarget(root: string, modules: Map<string, Module>, module: Module, expression: ts.Expression, imports: Map<string, ImportTarget>): { file: string; symbol: string } | null {
  const unwrapped = unwrap(expression);
  if (ts.isIdentifier(unwrapped)) {
    const imported = imports.get(unwrapped.text);
    if (imported && "symbol" in imported) return exportTarget(root, modules, imported.file, imported.symbol);
    return { file: module.file, symbol: unwrapped.text };
  }
  if (ts.isPropertyAccessExpression(unwrapped) && ts.isIdentifier(unwrapped.expression)) {
    const imported = imports.get(unwrapped.expression.text);
    if (imported && "namespace" in imported) return exportTarget(root, modules, imported.file, unwrapped.name.text);
    return null;
  }
  return null;
}

function literalArrayValues(expression: ts.Expression, call: ts.CallExpression): ts.Expression[] | null {
  const value = unwrap(expression);
  if (ts.isArrayLiteralExpression(value)) {
    const elements = value.elements.filter((element): element is ts.Expression => ts.isExpression(element));
    return elements.length === value.elements.length ? elements : null;
  }
  if (ts.isConditionalExpression(value)) {
    const left = literalArrayValues(value.whenTrue, call);
    const right = literalArrayValues(value.whenFalse, call);
    return left && right ? [...left, ...right] : null;
  }
  if (ts.isIdentifier(value)) {
    let current: ts.Node | undefined = call;
    while (current) {
      const declarations: ts.VariableDeclaration[] = [];
      const collect = (node: ts.Node): void => {
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === value.text && node.initializer) declarations.push(node);
        ts.forEachChild(node, collect);
      };
      collect(current);
      const declaration = declarations.at(-1);
      if (declaration?.initializer) return literalArrayValues(declaration.initializer, call);
      current = current.parent;
    }
  }
  return null;
}

function acquisition(root: string, modules: Map<string, Module>, module: Module, call: ts.CallExpression, imports: Map<string, ImportTarget>, implementation = false): Acquisition {
  if (implementation && relative(root, module.file) === INPUTS_RELATIVE) return null;
  const target = resolveCallTarget(root, modules, module, call.expression, imports);
  if (!target || (target.symbol !== "acquireLease" && target.symbol !== "acquireLeases")) return null;
  const argument = call.arguments[0];
  if (!argument) return { ranks: [], unresolved: true };
  const value = unwrap(argument);
  const rankFor = (expression: ts.Expression): LockRank | null => {
    const literal = unwrap(expression);
    if (!ts.isStringLiteralLike(literal)) return null;
    return literal.text in KINDS ? KINDS[literal.text as LockKind] : null;
  };
  if (target.symbol === "acquireLease") {
    const rank = rankFor(value);
    return rank === null ? { ranks: [], unresolved: true } : { ranks: [rank], unresolved: false };
  }
  if (!ts.isArrayLiteralExpression(value)) {
    const resolved = literalArrayValues(value, call);
    if (!resolved) return { ranks: [], unresolved: true };
    const ranks: LockRank[] = [];
    for (const element of resolved) {
      const rank = rankFor(element);
      if (rank === null) return { ranks: [], unresolved: true };
      ranks.push(rank);
    }
    return { ranks, unresolved: false };
  }
  if (value.elements.some((element) => !ts.isExpression(element))) return { ranks: [], unresolved: true };
  const ranks: LockRank[] = [];
  for (const element of value.elements) {
    const rank = rankFor(element);
    if (rank === null) return { ranks: [], unresolved: true };
    ranks.push(rank);
  }
  return { ranks, unresolved: false };
}

function collectFunctions(module: Module, functions: FunctionRecord[]): void {
  const visit = (node: ts.Node): void => {
    if (concreteFunction(node)) {
      const name = functionName(node);
      if (name) {
        const calls: ts.CallExpression[] = [];
        const collect = (child: ts.Node): void => {
          if (ts.isCallExpression(child)) calls.push(child);
          ts.forEachChild(child, collect);
        };
        collect(node.body);
        functions.push({ file: module.file, source: module.source, name, node, calls });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(module.sourceFile);
}

function topLevelCalls(sourceFile: ts.SourceFile): ts.CallExpression[] {
  const calls: ts.CallExpression[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionLike(node)) return;
    if (ts.isCallExpression(node)) calls.push(node);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return calls;
}

function functionRecord(functions: FunctionRecord[], file: string, symbol: string): FunctionRecord | null {
  const matches = functions.filter((item) => item.file === file && item.name === symbol);
  return matches.length === 1 ? matches[0]! : null;
}

export function checkLockOrder(root: string): Finding[] {
  const files: string[] = [];
  walk(root, root, files);
  const modules = new Map<string, Module>();
  for (const file of files) {
    try {
      const source = readFileSync(file, "utf8");
      modules.set(file, { file, source, sourceFile: parseFile(file, source) });
    } catch {
      continue;
    }
  }
  const functions: FunctionRecord[] = [];
  for (const module of modules.values()) collectFunctions(module, functions);
  const byKey = new Map<string, FunctionRecord>();
  for (const record of functions) byKey.set(`${record.file}#${record.name}`, record);
  const findings: Finding[] = [];
  const reported = new Set<string>();
  const visit = (record: FunctionRecord, held: LockRank[], trail: string[], active: Set<string>): void => {
    const key = `${record.file}#${record.name}`;
    if (active.has(key)) return;
    const nextActive = new Set(active).add(key);
    const module = modules.get(record.file);
    if (!module) return;
    const imports = importedTargets(root, module);
    let current = held;
    for (const call of record.calls) {
      const info = acquisition(root, modules, module, call, imports, record.name === "acquireLease" || record.name === "acquireLeases");
      if (info !== null) {
        if (info.unresolved) {
          findings.push(finding(root, record.file, record.source, call, `unresolvable lock acquisition ${call.expression.getText()}`, "UNRESOLVED_LOCK_ACQUISITION"));
        } else {
          const highest = current.at(-1);
          if (highest !== undefined) for (const rank of info.ranks) {
            if (rank <= highest) {
              const id = `${record.file}:${call.getStart()}:${rank}:${highest}`;
              if (!reported.has(id)) {
                reported.add(id);
                findings.push(finding(root, record.file, record.source, call, `rank ${rank} acquired while rank ${highest} is held through ${[...trail, record.name].join(" -> ")}`));
              }
            }
          }
          current = [...current, ...info.ranks];
        }
        continue;
      }
      const target = resolveCallTarget(root, modules, module, call.expression, imports);
      if (!target) continue;
      const child = byKey.get(`${target.file}#${target.symbol}`);
      if (child) visit(child, current, [...trail, record.name], nextActive);
    }
  };

  for (const module of modules.values()) {
    const imports = importedTargets(root, module);
    let held: LockRank[] = [];
    for (const call of topLevelCalls(module.sourceFile)) {
      const info = acquisition(root, modules, module, call, imports);
      if (info !== null) {
        if (info.unresolved) findings.push(finding(root, module.file, module.source, call, `unresolvable lock acquisition ${call.expression.getText()}`, "UNRESOLVED_LOCK_ACQUISITION"));
        else {
          const highest = held.at(-1);
          if (highest !== undefined) for (const rank of info.ranks) if (rank <= highest) findings.push(finding(root, module.file, module.source, call, `rank ${rank} acquired while rank ${highest} is held`));
          held = [...held, ...info.ranks];
        }
        continue;
      }
      const target = resolveCallTarget(root, modules, module, call.expression, imports);
      if (target) {
        const child = byKey.get(`${target.file}#${target.symbol}`);
        if (child) visit(child, held, ["<top-level>"], new Set());
      }
    }
  }
  for (const record of functions) visit(record, [], [], new Set());
  return findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column || a.code.localeCompare(b.code));
}

function main(): void {
  const root = path.resolve(process.argv[2] ?? process.cwd());
  const findings = checkLockOrder(root);
  for (const item of findings) console.error(`${item.code} ${item.file}:${item.line}:${item.column} ${item.message}`);
  if (findings.length > 0) process.exitCode = 1;
}

if (import.meta.main) main();
