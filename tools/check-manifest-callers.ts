import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { parse } from "svelte/compiler";

export type Finding = {
  code: string;
  file: string;
  line: number;
  column: number;
  message: string;
};

type ParsedFile = { file: string; source: string; sourceFile: ts.SourceFile };
type CallContext = { file: string; source: string; node: ts.Node; enclosing: string; callee: string; argument: ts.Expression | undefined; functionBody: string };
type AliasConfig = { libRoot: string | null; sourceFile: string | null };

const EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".mts", ".cjs", ".cts", ".svelte"]);
const SKIP_DIRS = new Set(["node_modules", ".svelte-kit", "build", ".wrangler", "static"]);
const CONSUMERS = new Set([
  "site/src/lib/manifest.ts",
  "site/src/lib/server/dataset.ts",
  "site/src/lib/server/mechanics.ts",
  "site/src/lib/client/search-index.ts",
  "site/src/routes/query/+page.svelte",
  "site/src/routes/+layout.server.ts",
  "site/src/routes/+layout.ts",
  "site/src/routes/+page.server.ts",
  "site/src/routes/+page.svelte",
  "site/src/routes/mechanics/+page.server.ts",
  "site/src/routes/mechanics/+page.svelte",
  "site/src/routes/mechanics/[id]/+page.server.ts",
  "site/src/routes/mechanics/[id]/+page.svelte",
  "site/src/routes/sheets/+page.server.ts",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function rel(root: string, file: string): string {
  return path.relative(root, file).replaceAll(path.sep, "/");
}

function location(source: string, offset: number): { line: number; column: number } {
  const before = source.slice(0, offset);
  const line = before.split("\n").length;
  const last = before.lastIndexOf("\n");
  return { line, column: offset - (last < 0 ? 0 : last + 1) + 1 };
}

function makeFinding(root: string, file: string, source: string, nodeOrOffset: ts.Node | number, code: string, message: string): Finding {
  const offset = typeof nodeOrOffset === "number" ? nodeOrOffset : nodeOrOffset.getStart();
  return { code, file: rel(root, file), ...location(source, offset), message };
}

function readAliasConfig(root: string): AliasConfig {
  const configFile = path.join(root, "site", ".svelte-kit", "tsconfig.json");
  try {
    const value: unknown = JSON.parse(readFileSync(configFile, "utf8"));
    if (!isRecord(value) || !isRecord(value.compilerOptions) || !isRecord(value.compilerOptions.paths)) return { libRoot: null, sourceFile: configFile };
    const paths = value.compilerOptions.paths;
    const candidates = paths["$lib"];
    if (!Array.isArray(candidates) || typeof candidates[0] !== "string") return { libRoot: null, sourceFile: configFile };
    return { libRoot: path.resolve(path.dirname(configFile), candidates[0]), sourceFile: configFile };
  } catch {
    return { libRoot: null, sourceFile: configFile };
  }
}

function resolveModule(root: string, importer: string, specifier: string, aliases: AliasConfig): string | null {
  let base: string | null = null;
  if (specifier === "$lib" || specifier.startsWith("$lib/")) {
    if (aliases.libRoot === null) return null;
    base = path.join(aliases.libRoot, specifier === "$lib" ? "index" : specifier.slice("$lib/".length));
  } else if (specifier.startsWith(".")) {
    base = path.resolve(path.dirname(importer), specifier);
  }
  if (base === null) return null;
  const candidates = [base, ...[...EXTENSIONS].map((extension) => `${base}${extension}`), ...[...EXTENSIONS].map((extension) => path.join(base!, `index${extension}`))];
  return candidates.find((candidate) => {
    try { readFileSync(candidate); return true; } catch { return false; }
  }) ?? null;
}

function sharedManifestFile(root: string): string {
  return path.join(root, "site", "src", "lib", "manifest.ts");
}

function ignored(root: string, file: string): boolean {
  const segments = path.relative(root, file).replaceAll(path.sep, "/").split("/");
  return segments.some((segment) => SKIP_DIRS.has(segment) || segment === "data" || segment === "extracted" || segment.startsWith("extracted-"));
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
    if (entry.isDirectory()) {
      if (!ignored(root, file)) walk(root, file, files);
    } else if (EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      files.push(file);
    }
  }
}

function svelteVirtualScripts(file: string, source: string): ts.SourceFile[] {
  const scripts: ts.SourceFile[] = [];
  const expression = /<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi;
  for (const [index, match] of [...source.matchAll(expression)].entries()) {
    const script = match[1];
    if (script !== undefined) scripts.push(ts.createSourceFile(`${file}.${index}.ts`, script, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS));
  }
  const markupExpressions = [...source.matchAll(/\{([^{}]+)\}/g)].map((match) => match[1]).filter((value): value is string => value !== undefined && !value.trim().startsWith("#") && !value.trim().startsWith("/"));
  if (markupExpressions.length > 0) scripts.push(ts.createSourceFile(`${file}.markup.ts`, markupExpressions.join(";\n"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS));
  return scripts;
}

function parseFiles(root: string, files: string[]): ParsedFile[] {
  const parsed: ParsedFile[] = [];
  for (const file of files.sort()) {
    let source: string;
    try {
      source = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    if (file.endsWith(".svelte")) {
      try {
        parse(source);
      } catch {
        continue;
      }
      for (const sourceFile of svelteVirtualScripts(file, source)) parsed.push({ file, source, sourceFile });
      continue;
    }
    const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : file.endsWith(".jsx") ? ts.ScriptKind.JSX : file.endsWith(".js") || file.endsWith(".mjs") || file.endsWith(".cjs") ? ts.ScriptKind.JS : ts.ScriptKind.TS;
    parsed.push({ file, source, sourceFile: ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind) });
  }
  return parsed;
}

function identifierText(node: ts.Node): string {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isPropertyAccessExpression(node)) return `${identifierText(node.expression)}.${node.name.text}`;
  if (ts.isElementAccessExpression(node) && ts.isStringLiteral(node.argumentExpression)) return `${identifierText(node.expression)}.${node.argumentExpression.text}`;
  return node.getText();
}

function literalText(node: ts.Expression | undefined): string | null {
  if (!node) return null;
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return null;
}

function enclosingFunction(node: ts.Node): ts.FunctionLikeDeclaration | null {
  let current: ts.Node | undefined = node;
  while (current) {
    if (ts.isFunctionLike(current) && "body" in current && current.body !== undefined) return current;
    current = current.parent;
  }
  return null;
}

function enclosingSymbol(node: ts.Node): string {
  let current: ts.Node | undefined = node;
  while (current) {
    if (ts.isFunctionDeclaration(current) && current.name) return current.name.text;
    if (ts.isMethodDeclaration(current) && current.name) return current.name.getText();
    if (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) {
      const parent = current.parent;
      if (ts.isVariableDeclaration(parent)) return parent.name.getText();
    }
    current = current.parent;
  }
  return "<module>";
}

function importedAliases(sourceFile: ts.SourceFile): Map<string, string> {
  const aliases = new Map<string, string>();
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !statement.importClause) continue;
    const clause = statement.importClause;
    if (clause.name) aliases.set(clause.name.text, clause.name.text);
    if (!clause.namedBindings) continue;
    if (ts.isNamespaceImport(clause.namedBindings)) aliases.set(clause.namedBindings.name.text, "namespace");
    else for (const element of clause.namedBindings.elements) aliases.set(element.name.text, element.propertyName?.text ?? element.name.text);
  }
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const init = identifierText(node.initializer);
      if (init === "fetch" || init === "readDataFile" || aliases.has(init)) aliases.set(node.name.text, aliases.get(init) ?? init);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return aliases;
}

function callsIn(parsed: ParsedFile): CallContext[] {
  const contexts: CallContext[] = [];
  const aliases = importedAliases(parsed.sourceFile);
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = identifierText(node.expression);
      const resolved = aliases.get(callee) ?? callee;
      const body = enclosingFunction(node)?.body?.getText() ?? "";
      contexts.push({ file: parsed.file, source: parsed.source, node, enclosing: enclosingSymbol(node), callee: resolved, argument: ts.isCallExpression(node) ? node.arguments[0] : undefined, functionBody: body });
    }
    if (ts.isNewExpression(node)) {
      const callee = identifierText(node.expression);
      const body = enclosingFunction(node)?.body?.getText() ?? "";
      contexts.push({ file: parsed.file, source: parsed.source, node, enclosing: enclosingSymbol(node), callee: `new ${callee}`, argument: node.arguments?.[0], functionBody: body });
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed.sourceFile);
  return contexts;
}

function allowedRawIo(context: CallContext, root: string): boolean {
  const file = rel(root, context.file);
  const argumentText = context.argument?.getText() ?? "";
  const argument = literalText(context.argument);
  const sourceHas = (needle: string): boolean => context.source.includes(needle);
  if (file === "site/src/worker.ts" && (context.callee === "fetch" || context.callee.endsWith(".fetch")) && context.enclosing === "fetch") return context.node.getText().includes("ASSETS");
  if (file === "site/src/lib/client/sql.ts" && context.callee === "fetch" && context.enclosing === "open") return argument === "/data/vespera.sqlite";
  if (file === "site/src/lib/client/search-index.ts" && context.callee === "fetch" && context.enclosing === "loadSearchIndex") return argument === "/data/search_index.json" || argumentText === "INDEX_URL" && sourceHas('INDEX_URL = "/data/search_index.json"');
  if (file === "site/src/lib/manifest.ts" && context.callee === "fetch" && context.enclosing === "fetchManifest") return argument === "/data/index.json" || argumentText === "MANIFEST_URL" && sourceHas('MANIFEST_URL = "/data/index.json"');
  if (file === "site/src/lib/server/dataset.ts" && context.callee === "readFileSync") {
    // This is the single capability-scoped edge: the name is path-safe and joins beneath a validated PublishedSnapshotCapability root.
    if (context.enclosing === "readPublishedSnapshotFile") {
      return (/(?:path\.)?join\(\s*(?:snapshot\.capability\.root|capability\.root)\s*,/.test(argumentText) || argumentText === "file" && /resolveBeneath\s*\(/.test(context.functionBody)) && /acceptSnapshot\s*\(/.test(context.functionBody);
    }
    if (context.enclosing === "acceptSnapshot") return /join\(\s*capability\.root\s*,/.test(argumentText) || argumentText === "manifestPath" && /manifestPath\s*=\s*path\.join\(\s*capability\.root\s*,/.test(context.functionBody);
    if (context.enclosing === "developmentCapability") return /join\(\s*root\s*,/.test(argumentText) && /findDataDir\s*\(/.test(context.functionBody);
  }
  if (file === "site/src/lib/server/dataset.ts" && context.callee === "readDataFile" && ["manifest", "table"].includes(context.enclosing)) return true;
  if (file === "site/src/lib/server/mechanics.ts" && context.callee === "readDataFile" && context.enclosing === "publishedMechanics") return true;
  return false;
}

function isRawIo(context: CallContext): boolean {
  const callee = context.callee;
  return callee === "fetch" || callee === "XMLHttpRequest" || callee === "new XMLHttpRequest" || callee === "Bun.file" || callee === "fs.readFile" || callee === "fs.readFileSync" || callee === "readFile" || callee === "readFileSync" || callee === "readDataFile" || callee.startsWith("fs.") && /(read|stat|readdir|access)/i.test(callee);
}

function sharedImportNames(root: string, item: ParsedFile, aliases: AliasConfig): string[] {
  const names: string[] = [];
  const shared = sharedManifestFile(root);
  for (const statement of item.sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    if (resolveModule(root, item.file, statement.moduleSpecifier.text, aliases) !== shared) continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) names.push(...bindings.elements.map((entry) => entry.propertyName?.text ?? entry.name.text));
    if (statement.importClause?.isTypeOnly && statement.importClause.name) names.push(statement.importClause.name.text);
    if (bindings && ts.isNamespaceImport(bindings)) names.push("namespace");
  }
  return names;
}

function localManifestDeclarations(item: ParsedFile): ts.Node[] {
  const declarations: ts.Node[] = [];
  const visit = (node: ts.Node): void => {
    if ((ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node)) && node.name.text === "Manifest") declarations.push(node);
    ts.forEachChild(node, visit);
  };
  visit(item.sourceFile);
  return declarations;
}

function semanticFindings(root: string, parsed: ParsedFile[], findings: Finding[], aliases: AliasConfig): void {
  const shared = sharedManifestFile(root);
  for (const item of parsed) {
    const relative = rel(root, item.file);
    const isShared = path.resolve(item.file) === path.resolve(shared);
    const isTest = /\.test\.(?:ts|tsx|js|jsx|mjs|mts|cjs|cts)$/.test(relative);
    for (const declaration of localManifestDeclarations(item)) {
      if (!isShared) findings.push(makeFinding(root, item.file, item.source, declaration, "LOCAL_MANIFEST_TYPE", "Manifest types must come from the shared manifest module"));
    }
    const manifestImports = sharedImportNames(root, item, aliases);
    const localManifest = localManifestDeclarations(item);
    const tracedRead = manifestImports.length > 0 || localManifest.length > 0 || /\b(?:fetchManifest|readDataFile|manifest)\s*\(/.test(item.source) || /(?:^|[/'"`])\/data\/index\.json(?:['"`?]|$)/.test(item.source);
    if (!isShared && !isTest && tracedRead && !CONSUMERS.has(relative)) {
      findings.push(makeFinding(root, item.file, item.source, 0, "UNKNOWN_MANIFEST_CONSUMER", "Manifest data must flow through an approved semantic consumer"));
    }
    if (!isShared && !isTest) {
      for (const match of item.source.matchAll(/\bschemaVersion\s*[:=]\s*(?:1|2|3)\b/g)) {
        if (manifestImports.length > 0 || localManifestDeclarations(item).length > 0 || /\b(?:manifest|tables|mechanics)\b/.test(item.source)) findings.push(makeFinding(root, item.file, item.source, match.index ?? 0, "STALE_SCHEMA_VERSION", "Manifest schema versions must come from the shared schema-3 validator"));
      }
    }
    if (!isShared && !isTest && /(?:^|[/'"`])\/data\/index\.json(?:['"`?]|$)/.test(item.source) && relative !== "site/src/lib/server/dataset.ts" && relative !== "site/src/lib/manifest.ts") {
      findings.push(makeFinding(root, item.file, item.source, item.source.search(/(?:^|[/'"`])\/data\/index\.json(?:['"`?]|$)/), "DIRECT_MANIFEST_READ", "index.json may be read only by the validated dataset or shared manifest helper"));
    }
  }
}

function staticImportCall(node: ts.Node): boolean {
  if (!ts.isCallExpression(node) || node.expression.kind !== ts.SyntaxKind.ImportKeyword) return false;
  const argument = node.arguments[0];
  return argument !== undefined && literalText(argument) !== null;
}

export function checkManifestCallers(root: string): Finding[] {
  const siteRoot = path.join(root, "site", "src");
  const aliases = readAliasConfig(root);
  const files: string[] = [];
  walk(root, siteRoot, files);
  const parsed = parseFiles(root, files);
  const findings: Finding[] = [];
  for (const item of parsed) {
    const relative = rel(root, item.file);
    if (/\$lib(?:\/|["'])/.test(item.source) && aliases.libRoot === null) findings.push(makeFinding(root, item.file, item.source, 0, "ALIAS_UNRESOLVED", `Unable to resolve $lib alias from ${aliases.sourceFile ?? "site configuration"}`));
    if (item.source.includes("<script") && item.file.endsWith(".svelte")) {
      // Parse errors are represented by the compiler, not by regular-expression guesses.
      try {
        parse(item.source);
      } catch (error) {
        findings.push(makeFinding(root, item.file, item.source, 0, "SVELTE_PARSE_ERROR", `Unable to parse Svelte source: ${error instanceof Error ? error.message : String(error)}`));
      }
    }
    for (const context of callsIn(item)) {
      const dynamicImport = ts.isCallExpression(context.node) && context.node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const raw = isRawIo(context);
      if (!raw && !dynamicImport) continue;
      if (dynamicImport) {
        if (!staticImportCall(context.node)) findings.push(makeFinding(root, item.file, item.source, context.node, "DYNAMIC_IMPORT", "Computed dynamic imports require an explicit reviewed callsite"));
      } else if (!allowedRawIo(context, root)) {
        const argument = literalText(context.argument);
        const pathDetail = argument === null ? "dynamic path" : argument;
        findings.push(makeFinding(root, item.file, item.source, context.node, "RAW_IO_NOT_ALLOWED", `${context.callee} at ${relative} has no approved path contract (${pathDetail})`));
      }
    }
  }
  semanticFindings(root, parsed, findings, aliases);
  const seen = new Set<string>();
  return findings.filter((item) => {
    const key = `${item.code}:${item.file}:${item.line}:${item.column}:${item.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column || a.code.localeCompare(b.code));
}

function main(): void {
  const root = path.resolve(process.argv[2] ?? process.cwd());
  const findings = checkManifestCallers(root);
  for (const item of findings) console.error(`${item.code} ${item.file}:${item.line}:${item.column} ${item.message}`);
  if (findings.length > 0) process.exitCode = 1;
}

if (import.meta.main) main();
