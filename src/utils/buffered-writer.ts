// Generic non-blocking buffered writer.
// Generalises the audit-log flush pattern (audit-service.ts): callers push entries into
// an in-memory buffer (O(1), never awaited on the request path); entries are persisted in
// batches on an interval and on graceful shutdown. Decoupled from Mongoose via a `persist`
// callback so it stays fully type-safe (no `any`) and reusable.

export type BufferedWriter<E> = {
  push: (entry: E) => void;
  flush: () => Promise<void>;
  start: () => void;
  stop: () => void;
  size: () => number;
};

export type BufferedWriterOptions<E> = {
  /** Persists one batch. Should reject on failure so the writer can log the loss. */
  persist: (batch: E[]) => Promise<void>;
  /** Flush interval in milliseconds. */
  intervalMs: number;
  /** Label used in log messages. */
  label: string;
};

export function createBufferedWriter<E>(opts: BufferedWriterOptions<E>): BufferedWriter<E> {
  const { persist, intervalMs, label } = opts;

  let buffer: E[] = [];
  let timer: ReturnType<typeof setInterval> | null = null;

  const flush = async (): Promise<void> => {
    if (buffer.length === 0) return;
    // Atomic swap — buffer is immediately empty for new entries during the await.
    const batch = buffer;
    buffer = [];
    try {
      await persist(batch);
    } catch (error) {
      console.error(
        `CRITICAL: ${label} failed to persist ${batch.length} buffered entries:`,
        error instanceof Error ? error.message : "Unknown error"
      );
    }
  };

  const start = (): void => {
    if (timer) return;
    timer = setInterval(() => {
      void flush();
    }, intervalMs);
    timer.unref();
    console.log(`${label} buffered writer started (${intervalMs / 1000}s interval)`);
  };

  const stop = (): void => {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  };

  const gracefulFlush = async (): Promise<void> => {
    stop();
    await flush();
  };
  process.on("SIGTERM", gracefulFlush);
  process.on("SIGINT", gracefulFlush);

  return {
    push: (entry: E): void => {
      buffer.push(entry);
    },
    flush,
    start,
    stop,
    size: (): number => buffer.length,
  };
}
