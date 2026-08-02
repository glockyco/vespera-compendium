import { balance, evalComposition, locateTable } from "@vespera/core";

/**
 * Find bundle constructs by their surrounding content, not their identifiers.
 * The minifier renames symbols on each release, but declared data keeps its shape.
 * Each helper returns the symbol name and source text.
 * Callers can rebuild declaration chains without a fixed name.
 */

export type DataRecord = Record<string, unknown>;
export type AnchoredDeclaration = { symbol: string; text: string };

/** Find an object or array declaration whose literal text satisfies every probe. */
export function declarationByAnchor(
  source: string,
  probes: RegExp | RegExp[],
  expected?: "{" | "[",
): AnchoredDeclaration {
  const tests = Array.isArray(probes) ? probes : [probes];
  const declaration = /(?:^|[\n,])\s*(?:const|let|var)?\s*([A-Za-z_$][\w$]*)\s*=\s*([[{])/g;
  let match: RegExpExecArray | null;
  while ((match = declaration.exec(source))) {
    if (expected && match[2] !== expected) continue;
    const open = source.indexOf(match[2]!, match.index);
    try {
      const [, end] = balance(source, open);
      const text = source.slice(open, end);
      if (!tests.every((probe) => probe.test(text))) {
        declaration.lastIndex = end;
        continue;
      }
      return { symbol: match[1]!, text };
    } catch {
      continue;
    }
  }
  throw new Error(`missing declaration anchor: ${tests.map((probe) => probe.source).join(", ")}`);
}

export function composedDeclarationByAnchor(
  source: string,
  probes: RegExp | RegExp[],
  expected?: "{" | "[",
  bindings?: Record<string, unknown>,
): unknown {
  return evalComposition(declarationByAnchor(source, probes, expected).text, bindings);
}

/** Evaluate the first `new Set(...)` whose argument text satisfies every probe. */
export function setByAnchor(source: string, probes: RegExp[]): Set<string> {
  const calls = /new\s+Set\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = calls.exec(source))) {
    const open = source.indexOf("(", match.index);
    try {
      const [, end] = balance(source, open);
      const text = source.slice(match.index, end);
      if (!probes.every((probe) => probe.test(text))) {
        calls.lastIndex = end;
        continue;
      }
      const raw = evalComposition(source.slice(open, end));
      return new Set(
        (Array.isArray(raw) ? raw : Object.keys((raw ?? {}) as object)).map((value) => String(value)),
      );
    } catch {
      continue;
    }
  }
  throw new Error(`missing Set anchor: ${probes.map((probe) => probe.source).join(", ")}`);
}

/** Find a function declaration whose body satisfies every probe. */
export function functionByAnchor(source: string, probes: RegExp[]): AnchoredDeclaration {
  const functions = /function\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/g;
  let match: RegExpExecArray | null;
  while ((match = functions.exec(source))) {
    const open = source.indexOf("{", match.index);
    try {
      const [, end] = balance(source, open);
      const text = source.slice(match.index, end);
      if (probes.every((probe) => probe.test(text))) return { symbol: match[1]!, text };
      functions.lastIndex = end;
    } catch {
      continue;
    }
  }
  throw new Error(`missing function anchor: ${probes.map((probe) => probe.source).join(", ")}`);
}

/** Call a zero-argument bundle function whose result is reachable only by running it. */
export function generated(source: string, probes: RegExp[], setup: string): unknown {
  const fn = functionByAnchor(source, probes);
  return evalComposition(`(()=>{${setup};${fn.text};return ${fn.symbol}();})()`);
}

export function callObjectAfterAnchor(
  source: string,
  callPattern: RegExp,
  idAnchor: string,
): DataRecord {
  for (const call of source.matchAll(callPattern)) {
    const at = call.index ?? 0;
    if (!source.slice(at, at + 500).includes(idAnchor)) continue;
    const open = source.indexOf("{", at);
    const [start, end] = balance(source, open);
    return evalComposition(source.slice(start, end)) as DataRecord;
  }
  throw new Error(`missing call/object anchor: ${idAnchor}`);
}

export function frozenObjectAfterAnchor(source: string, anchor: RegExp): DataRecord {
  const match = anchor.exec(source);
  if (!match) throw new Error(`missing object anchor: ${anchor.source}`);
  const open = source.indexOf("(", match.index);
  const [, end] = balance(source, open);
  return evalComposition(source.slice(open + 1, end - 1)) as DataRecord;
}

export function directTable(source: string, probes: RegExp[], minBytes: number): unknown {
  return evalComposition(locateTable(source, probes, minBytes).code);
}

/**
 * Slice a named declaration into runnable source.
 * A bundle statement can then run verbatim instead of being restated.
 * Semantic names such as `COMPLETE_GEAR_POWER_CURVE` survive minification.
 * A rename therefore throws instead of producing different numbers.
 */
export function namedDeclarationSource(source: string, name: string): string {
  const declaration = new RegExp(String.raw`\b${name}\s*=\s*`, "g");
  const match = declaration.exec(source);
  if (!match) throw new Error(`missing declaration: ${name}`);
  const [, end] = balance(source, match.index + match[0].length);
  return `const ${name} = ${source.slice(match.index + match[0].length, end)};`;
}

/** Slice a named function declaration into runnable source. */
export function namedFunctionSource(source: string, name: string): string {
  const declaration = new RegExp(String.raw`function\s+${name}\s*\(`, "g");
  const match = declaration.exec(source);
  if (!match) throw new Error(`missing function: ${name}`);
  const [, end] = balance(source, source.indexOf("{", match.index));
  return source.slice(match.index, end);
}

/** Slice the region between two content anchors, including the closing anchor. */
export function regionSource(source: string, from: string, to: string): string {
  const start = source.indexOf(from);
  if (start < 0) throw new Error(`missing region start: ${from}`);
  const end = source.indexOf(to, start);
  if (end < 0) throw new Error(`missing region end: ${to}`);
  return source.slice(start, end + to.length);
}
