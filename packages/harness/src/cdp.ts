export type CdpClient = {
  evaluate<T = unknown>(expression: string, timeoutMs?: number): Promise<T>;
  close(): void;
};

type CdpTarget = {
  type?: string;
  url?: string;
  webSocketDebuggerUrl?: string;
};

type PendingRequest = {
  expression: string;
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
};

const sleep = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

function resultError(payload: any): Error | null {
  if (payload.error) return new Error(payload.error.message ?? String(payload.error));
  const details = payload.result?.exceptionDetails;
  if (!details) return null;
  return new Error(details.exception?.description ?? details.text ?? "CDP evaluation failed");
}

export async function connect(port: number, urlSubstring?: string): Promise<CdpClient> {
  const deadline = Date.now() + 60_000;
  let target: CdpTarget | undefined;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (!response.ok) throw new Error(`CDP target list returned HTTP ${response.status}`);
      const targets = (await response.json()) as CdpTarget[];
      target = targets.find(
        (candidate) =>
          candidate.type === "page" &&
          Boolean(candidate.webSocketDebuggerUrl) &&
          (!urlSubstring || candidate.url?.includes(urlSubstring)),
      );
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

  socket.addEventListener("message", (event) => {
    let payload: any;
    try {
      payload = JSON.parse(String(event.data));
    } catch {
      return;
    }
    if (typeof payload.id !== "number") return;
    const request = pending.get(payload.id);
    if (!request) return;
    pending.delete(payload.id);
    clearTimeout(request.timer);
    const error = resultError(payload);
    if (error) {
      request.reject(error);
      return;
    }
    request.resolve(payload.result?.result?.value);
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

  return {
    evaluate<T = unknown>(expression: string, timeoutMs = 30_000): Promise<T> {
      if (closed || socket.readyState !== WebSocket.OPEN) {
        return Promise.reject(new Error("CDP WebSocket is not open"));
      }
      const id = nextId++;
      return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`CDP timeout after ${timeoutMs}ms: ${expression.slice(0, 120)}`));
        }, timeoutMs);
        pending.set(id, {
          expression,
          resolve: (value) => resolve(value as T),
          reject,
          timer,
        });
        socket.send(
          JSON.stringify({
            id,
            method: "Runtime.evaluate",
            params: { expression, awaitPromise: true, returnByValue: true },
          }),
        );
      });
    },
    close(): void {
      if (closed) return;
      closed = true;
      rejectPending("CDP client closed");
      socket.close();
    },
  };
}
