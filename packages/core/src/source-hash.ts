/**
 * Source hashing for reviewed code closures.
 *
 * The compendium publishes claims about a game that it does not own.
 * The honest question is not whether this code still runs. The question is whether this is the code that reviewers read.
 * Two rules answer that question.
 *
 * {@link canonicalSourceSlice} is the only range rule used when a byte range is cited.
 * It applies to shipped bundles and repository files. It normalizes line endings and trailing horizontal whitespace because editors can change them without changing meaning.
 * It changes nothing else. Identifiers, literals, operators, and comments remain because each can change behavior or a review conclusion.
 *
 * {@link hashSourceClosure} walks named root symbols at module granularity.
 * This granularity is coarse by design. A root that reads a module-scope object can be changed by a top-level initializer, write, registration side effect, or import evaluated only for effect.
 * None of those changes appear in the root's own text. Including every runtime top-level node of every reached module excludes all of them.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { canonicalJson, type CanonicalJson } from "./canonical-public-evidence.ts";
import {
  ECMASCRIPT_INTRINSICS,
  assertExternalLeafTestsComplete,
  externalLeafToken,
  isExternalLeaf,
  isExternalLeafSpecifier,
} from "./external-leaves.ts";
import {
  packageLeafRecord,
  packageNameOf,
  SOURCE_CLOSURE_PACKAGE_LEAVES,
  type PackageLeafRecord,
  type SourceClosureName,
} from "./source-package-leaves.ts";

const encoder = new TextEncoder();

/**
 * The canonical bytes of one source range.
 *
 * The outer slice is never trimmed. Leading indentation is part of what a reviewer read.
 * Only CRLF pairs and trailing spaces or tabs on each line are removed.
 */
export function canonicalSourceSlice(sourceText: string, start: number, end: number): Uint8Array {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start) {
    throw new Error(`invalid canonical source range [${start}, ${end})`);
  }
  if (end > sourceText.length) {
    throw new Error(
      `canonical source range [${start}, ${end}) exceeds ${sourceText.length} code units`,
    );
  }
  const lines = sourceText.slice(start, end).replace(/\r\n/g, "\n").split("\n");
  for (let index = 0; index < lines.length; index++) {
    lines[index] = lines[index]!.replace(/[ \t]+$/, "");
  }
  return encoder.encode(lines.join("\n"));
}

const utf8 = new TextDecoder("utf-8", { fatal: true });

/** The canonical text of one source range, for review output and field-level diffs. */
export function canonicalSourceText(sourceText: string, start: number, end: number): string {
  return utf8.decode(canonicalSourceSlice(sourceText, start, end));
}

/** SHA-256 hex of raw bytes or a string. */
export function sha256Hex(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** SHA-256 hex of a canonical JSON preimage. */
export function canonicalSha256(value: CanonicalJson): string {
  return sha256Hex(encoder.encode(canonicalJson(value)));
}

/** One root symbol of a closure. */
export type SourceClosureRoot = { module: string; symbol: string };

/** One included top-level node. Anonymous statements need no symbol. The ordinal identifies them. */
export type ClosureNodeRecord = { ordinal: number; nodeKind: string; canonicalSource: string };

export type SourceClosure = {
  /** Keyed by workspace-relative POSIX module path, sorted by that key. */
  modules: Record<string, ClosureNodeRecord[]>;
  /** Root metadata stays outside the module map, so renaming a root stays visible. */
  entries: { module: string; symbol: string }[];
  /** `<specifier>#<symbol>` platform leaves reached by this closure, sorted. */
  externalTokens: string[];
  /** Fixed tokens substituted for reviewed constant modules, sorted. */
  selfTokens: string[];
  /** Reviewed third-party packages reached by this closure, sorted by name. */
  packageLeaves: PackageLeafRecord[];
  sha256: string;
};

export type HashSourceClosureOptions = {
  /** The reviewed closure. It fixes the permitted package leaves. */
  closure: SourceClosureName;
  /**
   * Module paths whose references serialize as fixed tokens instead of being traversed.
   * Keys use workspace-relative POSIX paths.
   *
   * This is the self-hash boundary. A closure that reaches its own approved hash constant cannot include that constant's value.
   * Updating the constant to the reviewed candidate changes the candidate again. No fixed point exists.
   */
  selfTokens?: Readonly<Record<string, string>>;
  /**
   * Tokens this closure declares before discovery. These are currently CDP protocol operations.
   *
   * They always enter the preimage. Removing a declared capability is therefore a reviewable change even when no import mentions it.
   */
  declaredLeafTokens?: readonly string[];
};

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"] as const;

function parseJsonObject(file: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`expected a JSON object in ${file}`);
  }
  return parsed as Record<string, unknown>;
}

/**
 * Workspace package entry points, read from each member manifest.
 *
 * Resolving `@vespera/core` through the workspace keeps hashing independent of a symlink or copy in `node_modules`.
 * It also makes a module outside the workspace detectable instead of silently resolvable.
 */
function workspacePackageEntries(workspaceRoot: string): Map<string, string> {
  const entries = new Map<string, string>();
  const rootManifest = path.join(workspaceRoot, "package.json");
  if (!existsSync(rootManifest)) throw new Error(`no package.json at ${rootManifest}`);
  const globs = parseJsonObject(rootManifest).workspaces;
  const patterns = Array.isArray(globs)
    ? globs.filter((entry): entry is string => typeof entry === "string")
    : [];
  for (const pattern of patterns) {
    const directories = pattern.endsWith("/*")
      ? readdirSync(path.join(workspaceRoot, pattern.slice(0, -2)), { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .map((entry) => path.join(workspaceRoot, pattern.slice(0, -2), entry.name))
      : [path.join(workspaceRoot, pattern)];
    for (const directory of directories) {
      const manifest = path.join(directory, "package.json");
      if (!existsSync(manifest)) continue;
      const parsed = parseJsonObject(manifest);
      const name = parsed.name;
      const main = parsed.main;
      if (typeof name !== "string") continue;
      entries.set(name, path.resolve(directory, typeof main === "string" ? main : "index.ts"));
    }
  }
  return entries;
}

/** Workspace-relative POSIX path, the only module identity that a hash sees. */
function relativeModulePath(workspaceRoot: string, file: string): string {
  const relative = path.relative(workspaceRoot, file);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`module ${file} is outside the workspace root ${workspaceRoot}`);
  }
  return relative.split(path.sep).join("/");
}

function resolveRelative(fromFile: string, specifier: string): string | null {
  const base = path.resolve(path.dirname(fromFile), specifier);
  if (existsSync(base) && !isDirectory(base)) return base;
  for (const extension of SOURCE_EXTENSIONS) {
    const candidate = `${base}${extension}`;
    if (existsSync(candidate)) return candidate;
  }
  // `./foo.js` is how TypeScript emits a reference to `./foo.ts`. This repository writes the `.ts` form directly.
  // Both forms must resolve to the same file.
  const swapped = base.replace(/\.(js|mjs|cjs)$/, "");
  if (swapped !== base) {
    for (const extension of SOURCE_EXTENSIONS) {
      const candidate = `${swapped}${extension}`;
      if (existsSync(candidate)) return candidate;
    }
  }
  if (isDirectory(base)) {
    for (const extension of SOURCE_EXTENSIONS) {
      const candidate = path.join(base, `index${extension}`);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

function isDirectory(file: string): boolean {
  return existsSync(file) && statSync(file).isDirectory();
}

/** Statements that exist only for the type system and cannot affect a runtime binding. */
function isTypeOnlyStatement(statement: ts.Statement): boolean {
  if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) return true;
  if (ts.isImportDeclaration(statement)) {
    if (statement.importClause?.isTypeOnly) return true;
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings) && statement.importClause?.name === undefined) {
      return bindings.elements.length > 0 && bindings.elements.every((element) => element.isTypeOnly);
    }
    return false;
  }
  if (ts.isExportDeclaration(statement)) return statement.isTypeOnly;
  const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined;
  if (modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.DeclareKeyword)) return true;
  return false;
}

type ModuleSpecifierUse = {
  specifier: string;
  node: ts.ImportDeclaration | ts.ExportDeclaration;
  /** Imported symbol names at the boundary. `default` names a default import. */
  symbols: string[];
  namespaceBinding: ts.Identifier | null;
};

function moduleSpecifierUses(source: ts.SourceFile): ModuleSpecifierUse[] {
  const uses: ModuleSpecifierUse[] = [];
  for (const statement of source.statements) {
    if (isTypeOnlyStatement(statement)) continue;
    if (ts.isImportDeclaration(statement)) {
      if (!ts.isStringLiteral(statement.moduleSpecifier)) {
        throw new Error(`${source.fileName}: import specifier is not a string literal`);
      }
      const symbols: string[] = [];
      let namespaceBinding: ts.Identifier | null = null;
      const clause = statement.importClause;
      if (clause?.name) symbols.push("default");
      const bindings = clause?.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) namespaceBinding = bindings.name;
      if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          if (element.isTypeOnly) continue;
          symbols.push((element.propertyName ?? element.name).text);
        }
      }
      uses.push({ specifier: statement.moduleSpecifier.text, node: statement, symbols, namespaceBinding });
      continue;
    }
    if (ts.isExportDeclaration(statement) && statement.moduleSpecifier) {
      if (!ts.isStringLiteral(statement.moduleSpecifier)) {
        throw new Error(`${source.fileName}: export specifier is not a string literal`);
      }
      const symbols: string[] = [];
      if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
        for (const element of statement.exportClause.elements) {
          if (element.isTypeOnly) continue;
          symbols.push((element.propertyName ?? element.name).text);
        }
      }
      uses.push({ specifier: statement.moduleSpecifier.text, node: statement, symbols, namespaceBinding: null });
    }
  }
  return uses;
}

/** Rejects `import(...)` and `require(...)`. No reviewed closure can contain either form. */
function assertNoDynamicDependency(source: ts.SourceFile): void {
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        throw new Error(`${source.fileName}: dynamic import is not allowed in a reviewed closure`);
      }
      if (ts.isIdentifier(node.expression) && node.expression.text === "require") {
        throw new Error(`${source.fileName}: require() is not allowed in a reviewed closure`);
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(source, visit);
}

/**
 * Rejects computed access on a namespace import.
 *
 * `namespace.member` names one exact dependency that a reviewer can follow.
 * `namespace[key]` names no exact dependency, so the hash rejects it instead of approximating.
 */
function assertExactNamespaceAccess(source: ts.SourceFile, bindings: ts.Identifier[]): void {
  if (bindings.length === 0) return;
  const names = new Set(bindings.map((binding) => binding.text));
  const visit = (node: ts.Node): void => {
    if (
      ts.isElementAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      names.has(node.expression.text)
    ) {
      throw new Error(
        `${source.fileName}: computed access on namespace import ${node.expression.text} is not allowed`,
      );
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(source, visit);
}

/** Identifier positions that name a property or declaration instead of referencing a binding. */
function isReferencePosition(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (!parent) return false;
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return false;
  if (ts.isQualifiedName(parent) && parent.right === node) return false;
  if (ts.isPropertyAssignment(parent) && parent.name === node) return false;
  if (ts.isPropertySignature(parent) && parent.name === node) return false;
  if (ts.isMethodDeclaration(parent) && parent.name === node) return false;
  if (ts.isMethodSignature(parent) && parent.name === node) return false;
  if (ts.isPropertyDeclaration(parent) && parent.name === node) return false;
  if (ts.isEnumMember(parent) && parent.name === node) return false;
  if (ts.isBindingElement(parent) && parent.propertyName === node) return false;
  if (ts.isImportSpecifier(parent) || ts.isExportSpecifier(parent)) return false;
  if (ts.isImportClause(parent) || ts.isNamespaceImport(parent)) return false;
  if (ts.isFunctionDeclaration(parent) && parent.name === node) return false;
  if (ts.isClassDeclaration(parent) && parent.name === node) return false;
  if (ts.isVariableDeclaration(parent) && parent.name === node) return false;
  if (ts.isParameter(parent) && parent.name === node) return false;
  if (ts.isTypeParameterDeclaration(parent)) return false;
  if (ts.isTypeReferenceNode(parent) || ts.isTypeQueryNode(parent)) return false;
  if (ts.isLabeledStatement(parent) && parent.label === node) return false;
  if (ts.isBreakOrContinueStatement(parent) && parent.label === node) return false;
  if (ts.isShorthandPropertyAssignment(parent) && parent.name === node) return true;
  return true;
}

function isTypePosition(node: ts.Node): boolean {
  for (let current: ts.Node | undefined = node; current; current = current.parent) {
    if (ts.isTypeNode(current)) return true;
    if (ts.isTypeAliasDeclaration(current) || ts.isInterfaceDeclaration(current)) return true;
  }
  return false;
}

/**
 * Every ambient platform value that the module uses, as a leaf token.
 *
 * A free identifier that resolves nowhere is an error, not a leaf. An unresolved dependency is the case that this hash refuses.
 */
function ambientLeafTokens(
  source: ts.SourceFile,
  checker: ts.TypeChecker,
  workspaceRoot: string,
): Set<string> {
  const tokens = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && isReferencePosition(node) && !isTypePosition(node)) {
      const name = node.text;
      const symbol = checker.getSymbolAtLocation(node);
      const declarations = symbol?.declarations ?? [];
      const declaredInWorkspace = declarations.some((declaration) => {
        const file = declaration.getSourceFile().fileName;
        if (file.endsWith(".d.ts")) return false;
        const relative = path.relative(workspaceRoot, file);
        return !relative.startsWith("..") && !path.isAbsolute(relative);
      });
      if (!declaredInWorkspace) {
        if (ECMASCRIPT_INTRINSICS.has(name)) {
          // This is a language feature, not a platform dependency.
        } else if (declarations.length === 0 && symbol === undefined) {
          throw new Error(`${source.fileName}: unresolved free identifier ${name}`);
        } else {
          const token =
            name === "Bun" && ts.isPropertyAccessExpression(node.parent)
              ? externalLeafToken("bun", `Bun.${node.parent.name.text}`)
              : externalLeafToken("global", name);
          // An ambient platform value is a dependency even when no import mentions it.
          // The same declared-leaf rule therefore applies to imported symbols.
          const [specifier, symbolName] = token.split("#") as [string, string];
          if (!isExternalLeaf(specifier, symbolName)) {
            throw new Error(`${source.fileName}: platform value ${token} is not a reviewed leaf`);
          }
          tokens.add(token);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(source, visit);
  return tokens;
}

/**
 * Node records for one module: every runtime top-level statement, in source order.
 *
 * The ordinal comes from the statement list, not a symbol table.
 * An anonymous expression statement is therefore as identifiable as an exported function.
 * Reordering two statements is a visible change.
 */
function moduleNodeRecords(source: ts.SourceFile): ClosureNodeRecord[] {
  const text = source.getFullText();
  const records: ClosureNodeRecord[] = [];
  let ordinal = 0;
  for (const statement of source.statements) {
    if (isTypeOnlyStatement(statement)) continue;
    records.push({
      ordinal: ordinal++,
      nodeKind: ts.SyntaxKind[statement.kind]!,
      canonicalSource: canonicalSourceText(
        text,
        statement.getStart(source, false),
        statement.getEnd(),
      ),
    });
  }
  return records;
}

/**
 * Every workspace file that the closure can reach, found by parsing imports instead of asking TypeScript.
 *
 * This pass collects candidates and lets the hashing pass decide what is allowed.
 * A specifier that this pass cannot resolve is not added. The hashing pass then reports the unresolved dependency.
 */
function discoverWorkspaceFiles(
  workspaceRoot: string,
  rootFiles: readonly string[],
  workspacePackages: ReadonlyMap<string, string>,
  selfTokens: Readonly<Record<string, string>>,
): Set<string> {
  const found = new Set<string>();
  const queue = [...rootFiles];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (found.has(file)) continue;
    found.add(file);
    let relative: string;
    try {
      relative = relativeModulePath(workspaceRoot, file);
    } catch {
      continue;
    }
    if (selfTokens[relative]) continue;
    let source: ts.SourceFile;
    try {
      source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.ESNext, true);
    } catch {
      continue;
    }
    for (const use of moduleSpecifierUses(source)) {
      if (isExternalLeafSpecifier(use.specifier)) continue;
      if (use.specifier.startsWith(".")) {
        const resolved = resolveRelative(file, use.specifier);
        if (resolved) queue.push(resolved);
        continue;
      }
      const entry = workspacePackages.get(use.specifier);
      if (entry && existsSync(entry)) queue.push(entry);
    }
  }
  return found;
}

function createProgram(rootFiles: string[]): ts.Program {
  return ts.createProgram({
    rootNames: rootFiles,
    options: {
      allowJs: true,
      allowImportingTsExtensions: true,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      target: ts.ScriptTarget.ESNext,
      noEmit: true,
      skipLibCheck: true,
      strict: true,
      types: ["bun-types"],
    },
  });
}

/**
 * The hashed dependency closure of one set of root symbols.
 *
 * This function fails instead of approximating at every required boundary.
 * It rejects a missing or non-function root, a module outside the workspace, and an unlisted platform symbol.
 * It also rejects an unlisted package, dynamic import, computed namespace access, or unresolved free identifier.
 */
export function hashSourceClosure(
  workspaceRoot: string,
  roots: readonly SourceClosureRoot[],
  options: HashSourceClosureOptions,
): SourceClosure {
  assertExternalLeafTestsComplete();
  const absoluteRoot = path.resolve(workspaceRoot);
  const workspacePackages = workspacePackageEntries(absoluteRoot);
  const selfTokenPaths = options.selfTokens ?? {};

  const rootFiles = roots.map((root) => {
    const file = path.resolve(absoluteRoot, root.module);
    if (!existsSync(file)) throw new Error(`closure root module not found: ${root.module}`);
    return file;
  });

  // Discover reachable files with this module's resolution rules. Then build one program over only those files.
  // If TypeScript discovers files, the closure depends on the installer layout in `node_modules`.
  // A symlinked workspace package can resolve to the real repository when the caller points to a copied workspace.
  // The copy's modules then disappear from the closure.
  const discovered = discoverWorkspaceFiles(absoluteRoot, rootFiles, workspacePackages, selfTokenPaths);
  const program = createProgram([...discovered]);
  const checker = program.getTypeChecker();

  const entries: { module: string; symbol: string }[] = [];
  for (const [index, root] of roots.entries()) {
    const file = rootFiles[index]!;
    const source = program.getSourceFile(file);
    if (!source) throw new Error(`closure root module is not in the program: ${root.module}`);
    const moduleSymbol = checker.getSymbolAtLocation(source);
    const exported = moduleSymbol
      ? checker.getExportsOfModule(moduleSymbol).find((symbol) => symbol.name === root.symbol)
      : undefined;
    if (!exported) {
      throw new Error(`closure root ${root.module}#${root.symbol} is not exported`);
    }
    const declarations = exported.declarations ?? [];
    const isFunction = declarations.some(
      (declaration) =>
        ts.isFunctionDeclaration(declaration) ||
        ts.isMethodDeclaration(declaration) ||
        (ts.isVariableDeclaration(declaration) &&
          declaration.initializer !== undefined &&
          (ts.isArrowFunction(declaration.initializer) ||
            ts.isFunctionExpression(declaration.initializer))),
    );
    if (!isFunction) {
      throw new Error(`closure root ${root.module}#${root.symbol} is not a function`);
    }
    entries.push({ module: relativeModulePath(absoluteRoot, file), symbol: root.symbol });
  }

  const modules: Record<string, ClosureNodeRecord[]> = {};
  const externalTokens = new Set<string>(options.declaredLeafTokens ?? []);
  const reachedSelfTokens = new Set<string>();
  const packageNames = new Set<string>();
  const visited = new Set<string>();
  const queue = [...new Set(rootFiles)];

  while (queue.length > 0) {
    const file = queue.pop()!;
    if (visited.has(file)) continue;
    visited.add(file);
    const relative = relativeModulePath(absoluteRoot, file);

    const selfToken = selfTokenPaths[relative];
    if (selfToken) {
      reachedSelfTokens.add(selfToken);
      continue;
    }

    const source = program.getSourceFile(file);
    if (!source) throw new Error(`module is not in the program: ${relative}`);
    assertNoDynamicDependency(source);

    const uses = moduleSpecifierUses(source);
    // A namespace import from a reviewed package leaf is a leaf, not a traversable module.
    // Its member access is that package's business. Only workspace namespaces are constrained here.
    assertExactNamespaceAccess(
      source,
      uses
        .filter((use) => use.namespaceBinding !== null && use.specifier.startsWith("."))
        .map((use) => use.namespaceBinding!),
    );

    modules[relative] = moduleNodeRecords(source);
    for (const token of ambientLeafTokens(source, checker, absoluteRoot)) externalTokens.add(token);

    for (const use of uses) {
      const { specifier } = use;
      if (isExternalLeafSpecifier(specifier)) {
        const symbols = use.namespaceBinding ? ["default"] : use.symbols;
        if (symbols.length === 0) {
          throw new Error(`${relative}: side-effect import of platform module ${specifier}`);
        }
        for (const symbol of symbols) {
          if (!isExternalLeaf(specifier, symbol)) {
            throw new Error(`${relative}: platform symbol ${specifier}#${symbol} is not a reviewed leaf`);
          }
          externalTokens.add(externalLeafToken(specifier, symbol));
        }
        continue;
      }
      if (specifier.startsWith(".")) {
        const resolved = resolveRelative(file, specifier);
        if (!resolved) throw new Error(`${relative}: cannot resolve ${specifier}`);
        queue.push(resolved);
        continue;
      }
      const workspaceEntry = workspacePackages.get(specifier);
      if (workspaceEntry) {
        if (!existsSync(workspaceEntry)) {
          throw new Error(`${relative}: workspace package ${specifier} has no entry at ${workspaceEntry}`);
        }
        queue.push(workspaceEntry);
        continue;
      }
      const packageName = packageNameOf(specifier);
      if (!SOURCE_CLOSURE_PACKAGE_LEAVES[options.closure].includes(packageName)) {
        throw new Error(
          `${relative}: package ${packageName} is not a reviewed leaf of the ${options.closure} closure`,
        );
      }
      packageNames.add(packageName);
    }
  }

  const packageLeaves = [...packageNames]
    .sort()
    .map((name) => packageLeafRecord(absoluteRoot, name));

  // A declared package that the closure never reaches is an approval for an absent dependency.
  // The registry must name exactly what the closure reaches, not a superset.
  const declared = [...SOURCE_CLOSURE_PACKAGE_LEAVES[options.closure]].sort();
  const reached = [...packageNames].sort();
  if (declared.join(",") !== reached.join(",")) {
    throw new Error(
      `the ${options.closure} closure declares package leaves [${declared.join(", ")}] but reaches [${reached.join(", ") || "none"}]`,
    );
  }

  const sortedModules: Record<string, ClosureNodeRecord[]> = {};
  for (const key of Object.keys(modules).sort()) sortedModules[key] = modules[key]!;

  const closure: Omit<SourceClosure, "sha256"> = {
    modules: sortedModules,
    entries,
    externalTokens: [...externalTokens].sort(),
    selfTokens: [...reachedSelfTokens].sort(),
    packageLeaves,
  };
  return { ...closure, sha256: canonicalSha256(closurePreimage(options.closure, closure)) };
}

/**
 * The exact preimage of a closure hash.
 *
 * Review tooling and the approval writer call this function. Both serialize the same object instead of two objects that only happen to agree today.
 */
export function closurePreimage(
  closureName: SourceClosureName,
  closure: Omit<SourceClosure, "sha256">,
): CanonicalJson {
  return {
    version: 1,
    closure: closureName,
    entries: closure.entries.map((entry) => ({ module: entry.module, symbol: entry.symbol })),
    modules: Object.fromEntries(
      Object.entries(closure.modules).map(([module, records]) => [
        module,
        records.map((record) => ({
          ordinal: record.ordinal,
          nodeKind: record.nodeKind,
          canonicalSource: record.canonicalSource,
        })),
      ]),
    ),
    externalTokens: [...closure.externalTokens],
    selfTokens: [...closure.selfTokens],
    packageLeaves: closure.packageLeaves.map((leaf) => ({
      name: leaf.name,
      version: leaf.version,
      lockResolution: leaf.lockResolution,
      lockIntegrity: leaf.lockIntegrity,
      inventorySha256: leaf.inventorySha256,
      files: leaf.files.map((entry) => ({
        path: entry.path,
        bytes: entry.bytes,
        sha256: entry.sha256,
      })),
    })),
  };
}

/** Field-level differences between an approved closure and a fresh candidate, for review. */
export type ClosureFieldDiff = {
  field: string;
  kind: "added" | "removed" | "changed";
  approved: string | null;
  candidate: string | null;
};

/**
 * Every difference that a reviewer must read, with one entry per changed node, token, or package field.
 *
 * A whole-file diff hides the important change. A summary hides the same change.
 * One entry per changed slice lets a reviewer state what the approval covers.
 */
export function diffSourceClosures(
  approved: Omit<SourceClosure, "sha256"> | null,
  candidate: Omit<SourceClosure, "sha256">,
): ClosureFieldDiff[] {
  const diffs: ClosureFieldDiff[] = [];
  const approvedModules = approved?.modules ?? {};
  const moduleKeys = [...new Set([...Object.keys(approvedModules), ...Object.keys(candidate.modules)])].sort();
  for (const module of moduleKeys) {
    const left = approvedModules[module];
    const right = candidate.modules[module];
    if (!left) {
      for (const record of right ?? []) {
        diffs.push({
          field: `modules.${module}[${record.ordinal}]`,
          kind: "added",
          approved: null,
          candidate: record.canonicalSource,
        });
      }
      continue;
    }
    if (!right) {
      for (const record of left) {
        diffs.push({
          field: `modules.${module}[${record.ordinal}]`,
          kind: "removed",
          approved: record.canonicalSource,
          candidate: null,
        });
      }
      continue;
    }
    const count = Math.max(left.length, right.length);
    for (let ordinal = 0; ordinal < count; ordinal++) {
      const before = left[ordinal];
      const after = right[ordinal];
      const field = `modules.${module}[${ordinal}]`;
      if (before && !after) {
        diffs.push({ field, kind: "removed", approved: before.canonicalSource, candidate: null });
      } else if (!before && after) {
        diffs.push({ field, kind: "added", approved: null, candidate: after.canonicalSource });
      } else if (
        before &&
        after &&
        (before.canonicalSource !== after.canonicalSource || before.nodeKind !== after.nodeKind)
      ) {
        diffs.push({
          field,
          kind: "changed",
          approved: before.canonicalSource,
          candidate: after.canonicalSource,
        });
      }
    }
  }

  diffs.push(...diffStringList("entries", (approved?.entries ?? []).map(entryKey), candidate.entries.map(entryKey)));
  diffs.push(...diffStringList("externalTokens", approved?.externalTokens ?? [], candidate.externalTokens));
  diffs.push(...diffStringList("selfTokens", approved?.selfTokens ?? [], candidate.selfTokens));
  diffs.push(
    ...diffStringList(
      "packageLeaves",
      (approved?.packageLeaves ?? []).map(packageKey),
      candidate.packageLeaves.map(packageKey),
    ),
  );
  return diffs;
}

const entryKey = (entry: { module: string; symbol: string }): string => `${entry.module}#${entry.symbol}`;

const packageKey = (leaf: PackageLeafRecord): string =>
  `${leaf.name}@${leaf.version} ${leaf.lockResolution} ${leaf.lockIntegrity} ${leaf.inventorySha256}`;

function diffStringList(field: string, approved: readonly string[], candidate: readonly string[]): ClosureFieldDiff[] {
  const diffs: ClosureFieldDiff[] = [];
  for (const value of approved) {
    if (!candidate.includes(value)) diffs.push({ field, kind: "removed", approved: value, candidate: null });
  }
  for (const value of candidate) {
    if (!approved.includes(value)) diffs.push({ field, kind: "added", approved: null, candidate: value });
  }
  return diffs;
}
