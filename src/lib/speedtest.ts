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
  const url = "https://speed.cloudflare.com/__down?bytes=25000000";
  const minDurationMs = 5000; // Minimum 5 seconds for accurate measurement
  const progressIntervalMs = 200; // Report progress every 200ms

  let totalBytes = 0;
  const startTime = performance.now();
  let lastProgressTime = startTime;

  async function runDownload(): Promise<number> {
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

    const chunks: Uint8Array[] = [];

    while (true) {
      if (signal?.aborted) throw new Error("Test cancelled");
      const { done, value } = await reader.read();
      if (done) break;

      chunks.push(value);
      totalBytes += value.length;

      const now = performance.now();
      if (now - lastProgressTime >= progressIntervalMs) {
        const elapsedMs = now - startTime;
        const elapsedSec = elapsedMs / 1000;
        const mbps = (totalBytes * 8) / (elapsedSec * 1_000_000);
        onProgress(mbps);
        lastProgressTime = now;
      }
    }

    // Final progress update
    const finalElapsedMs = performance.now() - startTime;
    const finalElapsedSec = finalElapsedMs / 1000;
    const finalMbps = (totalBytes * 8) / (finalElapsedSec * 1_000_000);
    onProgress(finalMbps);

    return finalMbps;
  }

  // Run download at least once
  let finalMbps = await runDownload();
  const totalElapsedMs = performance.now() - startTime;

  // If completed too fast (< 2s), repeat until we reach minimum duration
  while (totalElapsedMs < minDurationMs) {
    if (signal?.aborted) throw new Error("Test cancelled");
    const additionalMbps = await runDownload();
    // Weighted average favoring the latest measurement
    finalMbps = (finalMbps + additionalMbps) / 2;
  }

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