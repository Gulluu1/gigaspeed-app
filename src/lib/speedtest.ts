export interface PingResult {
  ping: number;
  jitter: number;
}

export interface HistoryEntry {
  id: string;
  timestamp: number;
  download: number;
  upload: number;
  ping: number;
}

const HISTORY_KEY = "gigaspeed-history";
const MAX_HISTORY = 5;

export function getHistory(): HistoryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const stored = localStorage.getItem(HISTORY_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

export function saveHistory(entry: Omit<HistoryEntry, "id">): HistoryEntry[] {
  if (typeof window === "undefined") return [];
  const history = getHistory();
  const newEntry: HistoryEntry = {
    ...entry,
    id: crypto.randomUUID(),
  };
  const updated = [newEntry, ...history].slice(0, MAX_HISTORY);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
  return updated;
}

export function clearHistory(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(HISTORY_KEY);
}

export function getRating(downloadMbps: number): string {
  if (downloadMbps >= 100) return "Bahut tez";
  if (downloadMbps >= 25) return "Achhi";
  return "Slow";
}

export async function measurePing(signal?: AbortSignal): Promise<PingResult> {
  const url = "https://speed.cloudflare.com/__down?bytes=0";
  const samples: number[] = [];
  const maxAttempts = 5;

  for (let i = 0; i < maxAttempts; i++) {
    if (signal?.aborted) throw new Error("Test cancelled");
    const start = performance.now();
    try {
      const response = await fetch(url, {
        method: "GET",
        cache: "no-store",
        mode: "cors",
        signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`);
      }

      // Consume the response body to ensure the request completes
      await response.arrayBuffer();
      const end = performance.now();
      samples.push(end - start);
    } catch (error) {
      if (signal?.aborted) throw new Error("Test cancelled");
      if (error instanceof TypeError && error.message.includes("fetch")) {
        throw new Error("Internet se connect nahi ho pa raha. Wi-Fi/data check karke dobara try karo.");
      }
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new Error("Test cancelled");
      }
      throw new Error(`Ping measurement failed: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }

  if (samples.length === 0) {
    throw new Error("No successful ping measurements");
  }

  // Ping = minimum time (best case)
  const ping = Math.min(...samples);

  // Jitter = average difference between consecutive readings
  let jitter = 0;
  if (samples.length > 1) {
    const diffs: number[] = [];
    for (let i = 1; i < samples.length; i++) {
      diffs.push(Math.abs(samples[i] - samples[i - 1]));
    }
    jitter = diffs.reduce((a, b) => a + b, 0) / diffs.length;
  }

  return { ping, jitter };
}

export async function measureDownload(onProgress: (mbps: number) => void, signal?: AbortSignal): Promise<number> {
  const chunkSize = 10 * 1024 * 1024; // 10 MB per chunk
  const totalSize = 50 * 1024 * 1024; // 50 MB total target
  const stallTimeoutMs = 3000; // 3 seconds stall = abandon chunk
  const progressIntervalMs = 200; // Report progress every 200ms
  const minFirstChunkMs = 2000; // Minimum 2 seconds for first chunk to be valid

  let totalBytes = 0;
  const overallStartTime = performance.now();
  let lastProgressTime = overallStartTime;
  let firstChunkDurationMs = 0;
  let firstChunkBytes = 0;

  async function fetchChunk(): Promise<{ bytes: number; durationMs: number }> {
    const url = `https://speed.cloudflare.com/__down?bytes=${chunkSize}`;
    let response: Response;
    try {
      response = await fetch(url, {
        method: "GET",
        cache: "no-store",
        mode: "cors",
        signal,
      });
    } catch (error) {
      if (signal?.aborted) throw new Error("Test cancelled");
      if (error instanceof TypeError && error.message.includes("fetch")) {
        throw new Error("Internet se connect nahi ho pa raha. Wi-Fi/data check karke dobara try karo.");
      }
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new Error("Test cancelled");
      }
      throw error;
    }

    if (!response.ok) {
      throw new Error(`HTTP error: ${response.status}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("Response body is not readable");
    }

    let chunkBytes = 0;
    const chunkStartTime = performance.now();
    let lastDataTime = chunkStartTime;

    while (true) {
      if (signal?.aborted) throw new Error("Test cancelled");

      // Check for stall
      const now = performance.now();
      if (now - lastDataTime >= stallTimeoutMs && chunkBytes > 0) {
        break; // Stall detected, abandon this chunk
      }

      const { done, value } = await reader.read();
      if (done) break;

      chunkBytes += value.length;
      totalBytes += value.length;
      lastDataTime = performance.now();

      // Report progress
      if (lastDataTime - lastProgressTime >= progressIntervalMs) {
        const elapsedMs = lastDataTime - overallStartTime;
        const elapsedSec = elapsedMs / 1000;
        const mbps = (totalBytes * 8) / (elapsedSec * 1_000_000);
        onProgress(mbps);
        lastProgressTime = lastDataTime;
      }
    }

    const chunkDurationMs = performance.now() - chunkStartTime;
    return { bytes: chunkBytes, durationMs: chunkDurationMs };
  }

  // Fetch first chunk
  const firstChunk = await fetchChunk();
  firstChunkDurationMs = firstChunk.durationMs;
  firstChunkBytes = firstChunk.bytes;

  // If first chunk took >= 2 seconds, use it as final measurement
  if (firstChunkDurationMs >= minFirstChunkMs && firstChunkBytes > 0) {
    const finalElapsedMs = performance.now() - overallStartTime;
    const finalElapsedSec = finalElapsedMs / 1000;
    const finalMbps = (totalBytes * 8) / (finalElapsedSec * 1_000_000);
    onProgress(finalMbps);
    return finalMbps;
  }

  // First chunk was too fast (< 2s), continue fetching chunks until we reach target or minimum duration
  const minDurationMs = 5000; // Minimum 5 seconds total
  let totalElapsedMs = performance.now() - overallStartTime;

  while (totalElapsedMs < minDurationMs && totalBytes < totalSize) {
    if (signal?.aborted) throw new Error("Test cancelled");
    try {
      await fetchChunk();
    } catch (error) {
      // If chunk stalled/failed, continue to next chunk (don't fail entire test)
      if (error instanceof Error && error.message === "Test cancelled") throw error;
      // Log and continue - stall or error on this chunk, try next
    }
    totalElapsedMs = performance.now() - overallStartTime;
  }

  // Final measurement
  const finalElapsedMs = performance.now() - overallStartTime;
  const finalElapsedSec = finalElapsedMs / 1000;
  const finalMbps = (totalBytes * 8) / (finalElapsedSec * 1_000_000);
  onProgress(finalMbps);

  return finalMbps;
}

export async function measureUpload(onProgress: (mbps: number) => void, signal?: AbortSignal): Promise<number> {
  const url = "https://speed.cloudflare.com/__up";
  const minDurationMs = 5000; // Minimum 5 seconds for accurate measurement
  const progressIntervalMs = 200; // Report progress every 200ms
  const dataSize = 5 * 1024 * 1024; // 5 MB

  // Generate random data using crypto.getRandomValues
  const randomData = new Uint8Array(dataSize);
  crypto.getRandomValues(randomData);

  let totalBytes = 0;
  let startTime = performance.now();
  let lastProgressTime = startTime;

  async function runUpload(): Promise<number> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();

      // Handle abort signal
      const abortHandler = () => {
        xhr.abort();
        reject(new Error("Test cancelled"));
      };
      if (signal?.aborted) {
        reject(new Error("Test cancelled"));
        return;
      }
      signal?.addEventListener("abort", abortHandler);

      xhr.upload.addEventListener("progress", (event) => {
        if (event.lengthComputable) {
          totalBytes = event.loaded;
          const now = performance.now();
          if (now - lastProgressTime >= progressIntervalMs) {
            const elapsedMs = now - startTime;
            const elapsedSec = elapsedMs / 1000;
            const mbps = (totalBytes * 8) / (elapsedSec * 1_000_000);
            onProgress(mbps);
            lastProgressTime = now;
          }
        }
      });

      xhr.addEventListener("load", () => {
        signal?.removeEventListener("abort", abortHandler);
        if (xhr.status >= 200 && xhr.status < 300) {
          const finalElapsedMs = performance.now() - startTime;
          const finalElapsedSec = finalElapsedMs / 1000;
          const finalMbps = (totalBytes * 8) / (finalElapsedSec * 1_000_000);
          onProgress(finalMbps);
          resolve(finalMbps);
        } else {
          reject(new Error(`HTTP error: ${xhr.status}`));
        }
      });

      xhr.addEventListener("error", () => {
        signal?.removeEventListener("abort", abortHandler);
        reject(new Error("Internet se connect nahi ho pa raha. Wi-Fi/data check karke dobara try karo."));
      });

      xhr.addEventListener("abort", () => {
        signal?.removeEventListener("abort", abortHandler);
        reject(new Error("Test cancelled"));
      });

      xhr.addEventListener("timeout", () => {
        signal?.removeEventListener("abort", abortHandler);
        reject(new Error("Upload timeout"));
      });

      xhr.open("POST", url, true);
      xhr.timeout = 30000; // 30 second timeout
      xhr.send(randomData);
    });
  }

  // Run upload at least once
  let finalMbps = await runUpload();
  const totalElapsedMs = performance.now() - startTime;

  // If completed too fast (< 2s), repeat until we reach minimum duration
  while (totalElapsedMs < minDurationMs) {
    if (signal?.aborted) throw new Error("Test cancelled");
    totalBytes = 0; // Reset for next iteration
    startTime = performance.now();
    lastProgressTime = startTime;
    const additionalMbps = await runUpload();
    // Weighted average favoring the latest measurement
    finalMbps = (finalMbps + additionalMbps) / 2;
  }

  return finalMbps;
}