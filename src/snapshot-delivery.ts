/** Full snapshots are still authoritative: coalesce read-model updates, never
 * mutations. Keep one read/write in flight and one replaceable native value,
 * rather than a promise/frame queue proportional to token/watch frequency. */
export const SNAPSHOT_REFRESH_MS = 3000;
export const LEGACY_SNAPSHOT_REFRESH_MS = 9000;
export function snapshotDeliveryInterval(bytes: number): number {
  // A soft per-stream ~32 KiB/s target, not a strict rate cap: initial/fallback
  // snapshots still travel whole; the 2s cap favors final/docs responsiveness.
  return Math.min(2000, Math.max(350, Math.ceil(bytes * 1000 / (32 * 1024))));
}

/** Indices/length are JS UTF-16 code units, not UTF-8 bytes or code points.
 * JSON.stringify safely escapes any lone surrogate at a splice boundary. */
function snapshotPatch(previous: string, next: string, sequence: number): string {
  let prefix = 0, suffix = 0;
  const common = Math.min(previous.length, next.length);
  while (prefix < common && previous.charCodeAt(prefix) === next.charCodeAt(prefix)) prefix++;
  while (suffix < common - prefix && previous.charCodeAt(previous.length - 1 - suffix) === next.charCodeAt(next.length - 1 - suffix)) suffix++;
  return `event: snapshot-patch\ndata: ${JSON.stringify({
    base: sequence, sequence: sequence + 1, prefix,
    remove: previous.length - prefix - suffix,
    insert: next.slice(prefix, next.length - suffix), length: previous.length,
  })}\n\n`;
}

export function createSnapshotDelivery<Value>(options: {
  heartbeats: boolean;
  /** Explicit opt-in; every full snapshot (including reconnect) resets to zero. */
  patches?: boolean;
  authorized: () => boolean;
  /** Includes projection, presentation and JSON serialization on the same line. */
  read: (value: Value) => Promise<string>;
  /** Resolves only after transport backpressure clears (or the stream closes). */
  write: (frame: string) => Promise<void>;
  heartbeat: () => string;
  end: () => void;
}) {
  let stopped = false, busy = false;
  let pending: {value: Value; refresh: boolean} | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastJSON: string | undefined, lastSnapshotAt = -Infinity, lastFrameAt = -Infinity;
  let sequence = 0, nextReadAt = -Infinity;
  const stop = () => {
    stopped = true;
    pending = undefined;
    clearTimeout(timer);
    timer = undefined;
    lastJSON = undefined;
  };
  const end = () => { stop(); options.end(); };
  const pump = () => {
    if (stopped || busy || timer || !pending) return;
    if (!options.authorized()) { end(); return; }
    const delay = nextReadAt - Date.now();
    if (delay > 0) {
      timer = setTimeout(() => { timer = undefined; pump(); }, delay);
      return;
    }
    const current = pending;
    pending = undefined;
    busy = true;
    const startedAt = Date.now();
    void (async () => {
      try {
        const json = await options.read(current.value);
        if (stopped) return;
        if (!options.authorized()) { end(); return; }
        let frame = `event: snapshot\ndata: ${json}\n\n`;
        let bytes = Buffer.byteLength(frame);
        const now = Date.now();
        if (json !== lastJSON || (!options.heartbeats && now - lastSnapshotAt >= LEGACY_SNAPSHOT_REFRESH_MS)) {
          let nextSequence = 0;
          if (options.patches && lastJSON !== undefined && json !== lastJSON && sequence < Number.MAX_SAFE_INTEGER) {
            const patch = snapshotPatch(lastJSON, json, sequence), patchBytes = Buffer.byteLength(patch);
            if (patchBytes < bytes) { frame = patch; bytes = patchBytes; nextSequence = sequence + 1; }
          }
          // Only one frame may be in flight. Pending values are not serialized
          // into patches until drain, so each base is the last written snapshot.
          sequence = nextSequence;
          lastJSON = json;
          lastSnapshotAt = lastFrameAt = now;
          nextReadAt = startedAt + snapshotDeliveryInterval(bytes);
          await options.write(frame);
        } else {
          nextReadAt = startedAt + snapshotDeliveryInterval(bytes);
          if (current.refresh && options.heartbeats && now - lastFrameAt >= SNAPSHOT_REFRESH_MS) {
            lastFrameAt = now;
            await options.write(`event: heartbeat\ndata: ${options.heartbeat()}\n\n`);
          }
        }
      } catch { end(); }
      finally { busy = false; pump(); }
    })();
  };
  return {
    /** Native watch callbacks must not await transport; superseded intermediate
     * read models can be skipped, but the latest value always gets a trailing read. */
    offer(value: Value, refresh = false) {
      if (stopped) return;
      pending = {value, refresh: refresh || (pending?.refresh ?? false)};
      pump();
    },
    stop,
  };
}
