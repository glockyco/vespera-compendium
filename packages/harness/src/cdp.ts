export const CDP_METHODS = Object.freeze([
  "Debugger.enable",
  "Debugger.scriptParsed",
  "Network.enable",
  "Network.getResponseBody",
  "Network.loadingFinished",
  "Network.responseReceived",
  "Network.setCacheDisabled",
  "Page.enable",
  "Page.navigate",
  "Runtime.callFunctionOn",
  "Runtime.enable",
  "Runtime.evaluate",
  "Runtime.getProperties",
] as const);

export type CdpMethod = (typeof CDP_METHODS)[number];
export type CdpEventHandler = (params: unknown) => void;
export type CdpRemoteObject = {
  type?: string;
  subtype?: string;
  value?: unknown;
  objectId?: string;
  description?: string;
  unserializableValue?: string;
};
export type CdpPropertyDescriptor = {
  name?: string;
  value?: CdpRemoteObject;
  get?: CdpRemoteObject;
  set?: CdpRemoteObject;
};
export type CdpFunctionLocation = {
  scriptId?: string;
  lineNumber?: number;
  columnNumber?: number;
};
export type CdpNetworkResponse = {
  requestId: string;
  url: string;
  status: number;
  redirect: boolean;
  finished: boolean;
  body?: string;
  base64Encoded?: boolean;
};
export type CdpScriptParsed = { scriptId: string; url: string };

export type CdpClient = {
  send<T = unknown>(method: CdpMethod, params?: Record<string, unknown>): Promise<T>;
  on(event: string, handler: CdpEventHandler): () => void;
  evaluate<T = unknown>(expression: string, timeoutMs?: number): Promise<T>;
  callFunctionOn<T = unknown>(
    objectId: string,
    functionDeclaration: string,
    args: readonly CdpRemoteObject[],
    timeoutMs?: number,
  ): Promise<T>;
  getProperties(objectId: string): Promise<readonly CdpPropertyDescriptor[]>;
  close(): void;
  getNetworkResponses?(): readonly CdpNetworkResponse[];
  getScriptsParsed?(): readonly CdpScriptParsed[];
  /**
   * The external-leaf coverage IDs this session actually exercised.
   *
   * Recorded by the transport rather than asserted by a caller, so the aggregate reports what ran instead
   * of what the harness intended to run.
   */
  executedOperations(): ReadonlySet<string>;
};

/** `Network.getResponseBody` becomes `harness.cdp.network.getResponseBody`. */
export function cdpCoverageId(operation: string): string {
  const [domain, member] = operation.split(".");
  return `harness.cdp.${(domain ?? "").toLowerCase()}.${member ?? ""}`;
}

type CdpTarget = {
  type?: string;
  url?: string;
  webSocketDebuggerUrl?: string;
};

type PendingRequest = {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
};

type CdpMessage = {
  id?: unknown;
  method?: unknown;
  params?: unknown;
  result?: unknown;
  error?: unknown;
};

const sleep = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function protocolError(payload: CdpMessage): Error | null {
  if (isRecord(payload.error)) {
    const message = payload.error.message;
    return new Error(typeof message === "string" ? message : "CDP request failed");
  }
  return null;
}

function exceptionError(value: unknown): Error | null {
  if (!isRecord(value)) return null;
  const exception = value.exceptionDetails;
  if (!isRecord(exception)) return null;
  const exceptionValue = exception.exception;
  if (isRecord(exceptionValue) && typeof exceptionValue.description === "string") {
    return new Error(exceptionValue.description);
  }
  if (typeof exception.text === "string") return new Error(exception.text);
  return new Error("CDP evaluation failed");
}

function isAllowedMethod(method: string): method is CdpMethod {
  return (CDP_METHODS as readonly string[]).includes(method);
}

function responseResult(payload: CdpMessage): unknown {
  if (payload.result === undefined) return undefined;
  return payload.result;
}

function decodeEventParams(payload: CdpMessage): unknown {
  return payload.params ?? {};
}

export async function connect(port: number, urlSubstring?: string): Promise<CdpClient> {
  const deadline = Date.now() + 60_000;
  let target: CdpTarget | undefined;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (!response.ok) throw new Error(`CDP target list returned HTTP ${response.status}`);
      const parsed: unknown = await response.json();
      const targets = Array.isArray(parsed) ? parsed.filter(isRecord) : [];
      target = targets.find((candidate) => {
        const type = candidate.type;
        const websocket = candidate.webSocketDebuggerUrl;
        const url = candidate.url;
        return (
          type === "page" &&
          typeof websocket === "string" &&
          (!urlSubstring || (typeof url === "string" && url.includes(urlSubstring)))
        );
      }) as CdpTarget | undefined;
      if (target) break;
    } catch (error) {
      lastError = error;
    }
    await sleep(500);
  }

  if (!target?.webSocketDebuggerUrl) {
    const suffix = lastError instanceof Error ? `: ${lastError.message}` : "";
    throw new Error(`CDP page target unavailable on port ${port}${suffix}`);
  }

  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("CDP WebSocket open timeout after 10000ms")), 10_000);
    socket.addEventListener(
      "open",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
    socket.addEventListener(
      "error",
      () => {
        clearTimeout(timer);
        reject(new Error("CDP WebSocket failed to open"));
      },
      { once: true },
    );
  });

  let nextId = 1;
  let closed = false;
  const pending = new Map<number, PendingRequest>();
  const listeners = new Map<string, Set<CdpEventHandler>>();
  const networkResponses = new Map<string, CdpNetworkResponse>();
  const scriptsParsed: CdpScriptParsed[] = [];
  // The socket is already open at this point, so the handshake is the first demonstrated operation.
  const executed = new Set<string>(["harness.websocket.cdpHandshake"]);

  const rememberNetworkEvent = (method: string, params: unknown): void => {
    if (!isRecord(params)) return;
    if (method === "Network.responseReceived") {
      const requestId = params.requestId;
      const response = params.response;
      if (typeof requestId !== "string" || !isRecord(response) || typeof response.url !== "string") return;
      const status = typeof response.status === "number" ? response.status : 0;
      const redirect = status >= 300 && status < 400;
      networkResponses.set(requestId, {
        requestId,
        url: response.url,
        status,
        redirect,
        finished: false,
      });
      return;
    }
    if (method === "Network.loadingFinished") {
      const requestId = params.requestId;
      if (typeof requestId !== "string") return;
      const existing = networkResponses.get(requestId);
      if (existing) networkResponses.set(requestId, { ...existing, finished: true });
      return;
    }
    if (method === "Debugger.scriptParsed") {
      const scriptId = params.scriptId;
      const url = params.url;
      if (typeof scriptId !== "string" || typeof url !== "string") return;
      scriptsParsed.push({ scriptId, url });
    }
  };

  const dispatch = (method: string, params: unknown): void => {
    rememberNetworkEvent(method, params);
    for (const handler of listeners.get(method) ?? []) handler(params);
  };

  socket.addEventListener("message", (event) => {
    let payload: CdpMessage;
    try {
      const parsed: unknown = JSON.parse(String(event.data));
      if (!isRecord(parsed)) return;
      payload = parsed;
    } catch {
      return;
    }
    const method = payload.method;
    if (typeof method === "string") {
      // An observed event is a protocol operation the transport genuinely exercised, so it counts as
      // coverage in the same way a successful call does.
      if (isAllowedMethod(method)) executed.add(cdpCoverageId(method));
      dispatch(method, decodeEventParams(payload));
    }
    const id = payload.id;
    if (typeof id !== "number") return;
    const request = pending.get(id);
    if (!request) return;
    pending.delete(id);
    clearTimeout(request.timer);
    const error = protocolError(payload);
    if (error) {
      request.reject(error);
      return;
    }
    request.resolve(responseResult(payload));
  });

  const rejectPending = (message: string): void => {
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error(message));
    }
    pending.clear();
  };
  socket.addEventListener("close", () => {
    closed = true;
    rejectPending("CDP WebSocket closed");
  });

  const sendWithTimeout = <T>(method: CdpMethod, params: Record<string, unknown>, timeoutMs: number): Promise<T> => {
    if (!isAllowedMethod(method)) return Promise.reject(new Error(`CDP method is not allowlisted: ${method}`));
    if (closed || socket.readyState !== WebSocket.OPEN) return Promise.reject(new Error("CDP WebSocket is not open"));
    const id = nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`CDP timeout after ${timeoutMs}ms: ${method}`));
      }, timeoutMs);
      pending.set(id, {
        resolve: (value) => {
          // Coverage is recorded on a successful round trip, so a rejected call never reports the operation
          // as demonstrated.
          executed.add(cdpCoverageId(method));
          resolve(value as T);
        },
        reject,
        timer,
      });
      socket.send(JSON.stringify({ id, method, params }));
    });
  };

  const send = <T>(method: CdpMethod, params: Record<string, unknown> = {}): Promise<T> =>
    sendWithTimeout(method, params, 30_000);

  return {
    send,
    on(event: string, handler: CdpEventHandler): () => void {
      const handlers = listeners.get(event) ?? new Set<CdpEventHandler>();
      handlers.add(handler);
      listeners.set(event, handlers);
      return () => {
        handlers.delete(handler);
        if (handlers.size === 0) listeners.delete(event);
      };
    },
    async evaluate<T = unknown>(expression: string, timeoutMs = 30_000): Promise<T> {
      const result = await sendWithTimeout<{ result?: CdpRemoteObject; exceptionDetails?: unknown }>("Runtime.evaluate", {
        expression,
        awaitPromise: true,
        returnByValue: true,
        timeout: timeoutMs,
      }, timeoutMs);
      const error = exceptionError(result);
      if (error) throw error;
      return (result.result?.value as T | undefined) as T;
    },
    async callFunctionOn<T = unknown>(
      objectId: string,
      functionDeclaration: string,
      args: readonly CdpRemoteObject[],
      timeoutMs = 30_000,
    ): Promise<T> {
      const result = await sendWithTimeout<{ result?: CdpRemoteObject; exceptionDetails?: unknown }>("Runtime.callFunctionOn", {
        objectId,
        functionDeclaration,
        arguments: args,
        awaitPromise: true,
        returnByValue: true,
        executionContextId: undefined,
        timeout: timeoutMs,
      }, timeoutMs);
      const error = exceptionError(result);
      if (error) throw error;
      return (result.result?.value as T | undefined) as T;
    },
    async getProperties(objectId: string): Promise<readonly CdpPropertyDescriptor[]> {
      const response = await send<{ result?: unknown; internalProperties?: unknown }>("Runtime.getProperties", {
        objectId,
        ownProperties: true,
        accessorPropertiesOnly: false,
        generatePreview: false,
      });
      if (!isRecord(response)) return [];
      const properties = Array.isArray(response.result) ? response.result.filter(isRecord) : [];
      const internal = Array.isArray(response.internalProperties) ? response.internalProperties.filter(isRecord) : [];
      return [...properties, ...internal].map((property) => property as CdpPropertyDescriptor);
    },
    getNetworkResponses(): readonly CdpNetworkResponse[] {
      return [...networkResponses.values()];
    },
    getScriptsParsed(): readonly CdpScriptParsed[] {
      return [...scriptsParsed];
    },
    executedOperations(): ReadonlySet<string> {
      return new Set(executed);
    },
    close(): void {
      if (closed) return;
      closed = true;
      rejectPending("CDP client closed");
      socket.close();
    },
  };
}
