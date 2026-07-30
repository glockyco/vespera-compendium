import vm from "node:vm";

const OPEN: Record<string, string> = { "{": "}", "[": "]", "(": ")" };
const CLOSE = new Set(["}", "]", ")"]);

export function balance(source: string, from: number): [number, number] {
  let index = from;
  while (index < source.length && !"{[(".includes(source[index]!)) index++;
  const start = index;
  const stack: string[] = [];
  let inString: string | null = null;
  let inTemplate = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (; index < source.length; index++) {
    const current = source[index]!;
    const next = source[index + 1];
    if (inLineComment) {
      if (current === "\n") inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (current === "*" && next === "/") {
        inBlockComment = false;
        index++;
      }
      continue;
    }
    if (inString) {
      if (current === "\\") index++;
      else if (current === inString) inString = null;
      continue;
    }
    if (inTemplate) {
      if (current === "\\") index++;
      else if (current === "`") inTemplate = false;
      continue;
    }
    if (current === "/" && next === "/") {
      inLineComment = true;
      index++;
      continue;
    }
    if (current === "/" && next === "*") {
      inBlockComment = true;
      index++;
      continue;
    }
    if (current === '"' || current === "'") {
      inString = current;
      continue;
    }
    if (current === "`") {
      inTemplate = true;
      continue;
    }
    if (OPEN[current]) {
      stack.push(OPEN[current]);
      continue;
    }
    if (CLOSE.has(current)) {
      if (stack.pop() !== current) throw new Error(`unbalanced literal at ${index}`);
      if (stack.length === 0) return [start, index + 1];
    }
  }
  throw new Error("unterminated literal");
}

export function evalLiteral(code: string): unknown {
  const real: Record<PropertyKey, unknown> = {
    Object,
    Array,
    Math,
    JSON,
    Number,
    String,
    Boolean,
    Date,
    Map,
    Set,
    RegExp,
    Symbol,
    isNaN,
    parseInt,
    parseFloat,
    Infinity,
    NaN,
    undefined,
  };
  let stub: any;
  stub = new Proxy(function () {}, {
    get: () => stub,
    apply: () => stub,
    construct: () => stub,
    has: () => true,
  });
  const sandbox = new Proxy(real, {
    has: () => true,
    get: (target, key) => (key in target ? target[key] : key === Symbol.unscopables ? undefined : stub),
  });
  return vm.runInNewContext(`(${code})`, vm.createContext(sandbox), { timeout: 20_000 });
}

export function evalComposition(code: string, bindings: Record<string, unknown> = {}): unknown {
  const sandbox = {
    Object,
    Array,
    Math,
    JSON,
    Number,
    String,
    Boolean,
    Date,
    Map,
    Set,
    RegExp,
    Symbol,
    isNaN,
    parseInt,
    parseFloat,
    Infinity,
    NaN,
    undefined,
    ...bindings,
  };
  return vm.runInNewContext(`(${code})`, vm.createContext(sandbox), { timeout: 20_000 });
}

export function collectionSize(value: unknown): number {
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === "object") return Object.keys(value).length;
  return 0;
}

export type LocatedTable = {
  code: string;
  value: unknown;
  symbol: string;
  bytes: number;
  count: number;
};

export function locateTable(source: string, probes: RegExp[], minBytes = 0): LocatedTable {
  const candidates: Array<{ symbol: string; text: string }> = [];
  const declaration = /(?:^|\n)(?:\s{0,4})(?:const|let|var)?\s*([A-Za-z_$][\w$]*)\s*=\s*([[{])\s*(?=\n)/g;
  let match: RegExpExecArray | null;
  while ((match = declaration.exec(source))) {
    const open = match.index + match[0].lastIndexOf(match[2]!);
    try {
      const [, end] = balance(source, open);
      const text = source.slice(open, end);
      if (text.length >= minBytes && probes.every((probe) => probe.test(text))) {
        candidates.push({ symbol: match[1]!, text });
      }
    } catch {
      // Ignore malformed candidates and keep searching.
    }
    declaration.lastIndex = open + 1;
  }
  candidates.sort((left, right) => right.text.length - left.text.length);
  for (const candidate of candidates) {
    try {
      const value = evalLiteral(candidate.text);
      const count = collectionSize(value);
      if (count > 0) {
        return { code: candidate.text, value, symbol: candidate.symbol, bytes: candidate.text.length, count };
      }
    } catch {
      // A larger decoy can fail evaluation. Try the next candidate.
    }
  }
  throw new Error(`could not locate table for probes ${probes.map((probe) => probe.source).join(", ")}`);
}
