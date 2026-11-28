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

export interface PingResult {
  ping: number;
  jitter: number;
  failed?: boolean; // true if all retries failed
}

export async function measurePing(signal?: AbortSignal): Promise<PingResult> {
  const url = "https://speed.cloudflare.com/__down?bytes=0";
  const samples: number[] = [];
  const maxRetries = 3; // 3 retries
  const attemptTimeoutMs = 10000; // 10s timeout per attempt

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    if (signal?.aborted) throw new Error("Test cancelled");

    // Create a timeout for this attempt
    const attemptController = new AbortController();
    const attemptTimeout = setTimeout(() => attemptController.abort(), attemptTimeoutMs);

    // Combine signals
    const combinedSignal = signal
      ? AbortSignal.any([signal, attemptController.signal])
      : attemptController.signal;

    try {
      const start = performance.now();
      const response = await fetch(url, {
        method: "GET",
        cache: "no-store",
        mode: "cors",
        signal: combinedSignal,
      });

      clearTimeout(attemptTimeout);

      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`);
      }

      // Consume the response body to ensure the request completes
      await response.arrayBuffer();
      const end = performance.now();
      samples.push(end - start);

      // If we got a successful sample, we can break early (optional: keep all 5 for jitter)
    } catch (error) {
      clearTimeout(attemptTimeout);
      if (signal?.aborted) throw new Error("Test cancelled");
      if (error instanceof DOMException && error.name === "AbortError") {
        // Timeout or external abort - continue to next retry
        console.log(`[Ping] Attempt ${attempt + 1} timed out, retrying...`);
        continue;
      }
      if (error instanceof TypeError && error.message.includes("fetch")) {
        // Network error - this is likely a real connectivity issue
        console.log(`[Ping] Attempt ${attempt + 1} network error:`, error.message);
        // Don't retry network errors - they'll likely fail again
        throw new Error("Internet se connect nahi ho pa raha. Wi-Fi/data check karke dobara try karo.");
      }
      console.log(`[Ping] Attempt ${attempt + 1} failed:`, error instanceof Error ? error.message : error);
      // Continue to next retry for other errors
    }
  }

  // If we have at least one sample, return it
  if (samples.length > 0) {
    // Check if any ping is > 2000ms - if so, consider it failed
    const hasHighPing = samples.some(p => p > 2000);
    if (hasHighPing) {
      console.log("[Ping] High ping detected (>2000ms), marking as failed");
      return { ping: 0, jitter: 0, failed: true };
    }

    // Ping = median of samples (more robust than min)
    const sorted = [...samples].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const ping = sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];

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

  // All retries failed - return failed result instead of throwing
  console.log("[Ping] All retries failed, returning failed result");
  return { ping: 0, jitter: 0, failed: true };
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
  const dataSize = 20 * 1024 * 1024; // 20 MB buffer (larger to ensure 10s+ upload)
  const uploadDurationMs = 10000; // Fixed 10 second upload window
  const chunkSize = 65536; // 64 KB - max for crypto.getRandomValues

  const EMA_ALPHA = 0.2; // EMA alpha for smoothing
  const CLAMP_MULTIPLIER = 1.5; // Live value max 1.5x running average

  // Generate random data using crypto.getRandomValues in 64KB chunks
  const randomData = new Uint8Array(dataSize);
  for (let offset = 0; offset < dataSize; offset += chunkSize) {
    if (signal?.aborted) throw new Error("Test cancelled");
    const currentChunkSize = Math.min(chunkSize, dataSize - offset);
    const chunk = new Uint8Array(currentChunkSize);
    crypto.getRandomValues(chunk);
    randomData.set(chunk, offset);
  }

  const startTime = performance.now();

  // XHR is primary for upload since it has reliable progress events
  async function runUploadWithXHR(): Promise<{ mbps: number; bytes: number }> {
    console.log("[Upload] Starting timed upload (XHR) to", url, "duration:", uploadDurationMs, "ms");

    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      let xhrTotalBytes = 0;
      const xhrStartTime = performance.now();
      let xhrLastProgressTime = xhrStartTime;
      let xhrLiveMbpsEMA = 0;

      const externalAbortHandler = () => {
        console.log("[Upload] XHR: External abort");
        xhr.abort();
        reject(new Error("Test cancelled"));
      };
      if (signal?.aborted) {
        reject(new Error("Test cancelled"));
        return;
      }
      signal?.addEventListener("abort", externalAbortHandler);

      const durationTimeout = setTimeout(() => {
        console.log("[Upload] XHR: Duration reached, aborting");
        xhr.abort();
      }, uploadDurationMs);

      xhr.upload.addEventListener("progress", (event) => {
        if (event.lengthComputable) {
          xhrTotalBytes = event.loaded;

          const now = performance.now();
          if (now - xhrLastProgressTime >= progressIntervalMs) {
            const elapsedMs = now - xhrStartTime;
            const elapsedSec = elapsedMs / 1000;
            const cumulativeMbps = (xhrTotalBytes * 8) / (elapsedSec * 1_000_000);

            // Smooth with EMA (same as download path)
            if (elapsedMs >= 2000) {
              const rawMbps = cumulativeMbps;
              if (xhrLiveMbpsEMA === 0) {
                xhrLiveMbpsEMA = rawMbps;
              } else {
                xhrLiveMbpsEMA = EMA_ALPHA * rawMbps + (1 - EMA_ALPHA) * xhrLiveMbpsEMA;
              }
              const runningAvg = cumulativeMbps;
              const clampedMbps = Math.min(xhrLiveMbpsEMA, runningAvg * CLAMP_MULTIPLIER);
              onProgress(clampedMbps);
            }
            xhrLastProgressTime = now;
          }
        }
      });

      xhr.addEventListener("load", () => {
        clearTimeout(durationTimeout);
        signal?.removeEventListener("abort", externalAbortHandler);

        const finalElapsedMs = performance.now() - xhrStartTime;
        const finalElapsedSec = finalElapsedMs / 1000;
        const finalMbps = (xhrTotalBytes * 8) / (finalElapsedSec * 1_000_000);
        onProgress(finalMbps);

        if (xhr.status >= 200 && xhr.status < 300) {
          console.log("[Upload] XHR completed:", xhr.status, "final:", finalMbps.toFixed(2), "Mbps");
          resolve({ mbps: finalMbps, bytes: xhrTotalBytes });
        } else {
          console.error("[Upload] XHR HTTP error:", xhr.status);
          if (xhrTotalBytes > 0) {
            resolve({ mbps: finalMbps, bytes: xhrTotalBytes });
          } else {
            reject(new Error(`HTTP error: ${xhr.status}`));
          }
        }
      });

      xhr.addEventListener("error", () => {
        clearTimeout(durationTimeout);
        signal?.removeEventListener("abort", externalAbortHandler);
        console.error("[Upload] XHR Network error");
        if (xhrTotalBytes > 0) {
          const finalElapsedMs = performance.now() - xhrStartTime;
          const finalElapsedSec = finalElapsedMs / 1000;
          const finalMbps = (xhrTotalBytes * 8) / (finalElapsedSec * 1_000_000);
          onProgress(finalMbps);
          resolve({ mbps: finalMbps, bytes: xhrTotalBytes });
        } else {
          reject(new Error("XHR Network error"));
        }
      });

      xhr.addEventListener("abort", () => {
        clearTimeout(durationTimeout);
        signal?.removeEventListener("abort", externalAbortHandler);
        if (xhrTotalBytes > 0) {
          const finalElapsedMs = performance.now() - xhrStartTime;
          const finalElapsedSec = finalElapsedMs / 1000;
          const finalMbps = (xhrTotalBytes * 8) / (finalElapsedSec * 1_000_000);
          onProgress(finalMbps);
          resolve({ mbps: finalMbps, bytes: xhrTotalBytes });
        } else {
          reject(new Error("XHR aborted"));
        }
      });

      xhr.addEventListener("timeout", () => {
        clearTimeout(durationTimeout);
        signal?.removeEventListener("abort", externalAbortHandler);
        if (xhrTotalBytes > 0) {
          const finalElapsedMs = performance.now() - xhrStartTime;
          const finalElapsedSec = finalElapsedMs / 1000;
          const finalMbps = (xhrTotalBytes * 8) / (finalElapsedSec * 1_000_000);
          onProgress(finalMbps);
          resolve({ mbps: finalMbps, bytes: xhrTotalBytes });
        } else {
          reject(new Error("XHR timeout"));
        }
      });

      xhr.open("POST", url, true);
      xhr.timeout = uploadDurationMs;
      xhr.setRequestHeader("Content-Type", "application/octet-stream");
      xhr.send(randomData);
    });
  }

  async function runUpload(): Promise<{ mbps: number; bytes: number }> {
    // XHR is primary for upload since it has reliable progress events
    return await runUploadWithXHR();
  }

  async function runUploadWithTimeout(): Promise<{ mbps: number; bytes: number }> {
    // Run upload with 10s timeout - always return partial result if bytes > 0
    const result = await runUpload();
    // Always return result if we have bytes, even if timeout occurred
    return result;
  }

      // Run upload at least once
      const firstResult = await runUploadWithTimeout();
      let finalMbps = firstResult.mbps;
      const totalElapsedMs = performance.now() - startTime;

      // If completed too fast (< 2s), repeat until we reach minimum duration
      while (totalElapsedMs < minDurationMs) {
        if (signal?.aborted) throw new Error("Test cancelled");
        const additionalResult = await runUploadWithTimeout();
        // Weighted average favoring the latest measurement
        finalMbps = (finalMbps + additionalResult.mbps) / 2;
      }

      return finalMbps;
}