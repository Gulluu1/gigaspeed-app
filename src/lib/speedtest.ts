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
  const dataSize = 10 * 1024 * 1024; // 10 MB - larger buffer for sustained upload
  const uploadDurationMs = 15000; // Fixed 15 second upload window

  // Generate random data using crypto.getRandomValues in 64KB chunks
  const chunkSize = 65536; // 64 KB - max for crypto.getRandomValues
  const randomData = new Uint8Array(dataSize);
  for (let offset = 0; offset < dataSize; offset += chunkSize) {
    if (signal?.aborted) throw new Error("Test cancelled");
    const currentChunkSize = Math.min(chunkSize, dataSize - offset);
    const chunk = new Uint8Array(currentChunkSize);
    crypto.getRandomValues(chunk);
    randomData.set(chunk, offset);
  }

  let totalBytes = 0;
  const startTime = performance.now();
  let lastProgressTime = startTime;

  async function runUpload(): Promise<{ mbps: number; bytes: number }> {
    console.log("[Upload] Starting timed upload to", url, "duration:", uploadDurationMs, "ms");

    // Use fetch with stream to get upload progress
    const controller = new AbortController();
    const abortSignal = controller.signal;

    // Handle external abort signal
    const externalAbortHandler = () => {
      console.log("[Upload] External abort signal received");
      controller.abort();
      throw new Error("Test cancelled");
    };
    if (signal?.aborted) throw new Error("Test cancelled");
    signal?.addEventListener("abort", externalAbortHandler);

    // Auto-abort after fixed duration
    const durationTimeout = setTimeout(() => {
      console.log("[Upload] Duration reached, aborting");
      controller.abort();
    }, uploadDurationMs);

    // Create a readable stream that feeds data and tracks progress
    const uploadStream = new ReadableStream({
      async start(controller) {
        let sentBytes = 0;
        const streamChunkSize = 65536; // 64KB chunks
        let offset = 0;

        const sendChunk = async () => {
          while (offset < dataSize && !abortSignal.aborted) {
            const currentChunkSize = Math.min(streamChunkSize, dataSize - offset);
            const chunk = randomData.slice(offset, offset + currentChunkSize);

            try {
              controller.enqueue(chunk);
              sentBytes += currentChunkSize;
              totalBytes = sentBytes;
              offset += currentChunkSize;

              // Report progress
              const now = performance.now();
              if (now - lastProgressTime >= progressIntervalMs) {
                const elapsedMs = now - startTime;
                const elapsedSec = elapsedMs / 1000;
                const mbps = (totalBytes * 8) / (elapsedSec * 1_000_000);
                onProgress(mbps);
                lastProgressTime = now;
              }

              // Small delay to not overwhelm
              await new Promise(r => setTimeout(r, 1));
            } catch (e) {
              if (abortSignal.aborted) break;
              throw e;
            }
          }
          if (!abortSignal.aborted) {
            controller.close();
          }
        };

        await sendChunk();
      }
    });

    // Start the upload
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response = await (fetch as any)(url, {
        method: "POST",
        body: uploadStream,
        signal: abortSignal,
        headers: {
          "Content-Type": "application/octet-stream",
        },
        duplex: "half", // Required for streaming upload
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      clearTimeout(durationTimeout);
      signal?.removeEventListener("abort", externalAbortHandler);
      console.log("[Upload] Fetch response:", response.status);

      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`);
      }

      // Upload completed successfully
      const finalElapsedMs = performance.now() - startTime;
      const finalElapsedSec = finalElapsedMs / 1000;
      const finalMbps = (totalBytes * 8) / (finalElapsedSec * 1_000_000);
      onProgress(finalMbps);

      return { mbps: finalMbps, bytes: totalBytes };
    } catch (error: unknown) {
      clearTimeout(durationTimeout);
      signal?.removeEventListener("abort", externalAbortHandler);

      if (abortSignal.aborted) {
        // Timeout or external abort - check if we have data
        if (totalBytes > 0) {
          const finalElapsedMs = performance.now() - startTime;
          const finalElapsedSec = finalElapsedMs / 1000;
          const finalMbps = (totalBytes * 8) / (finalElapsedSec * 1_000_000);
          onProgress(finalMbps);
          console.log("[Upload] Partial result on timeout/abort:", finalMbps.toFixed(2), "Mbps");
          return { mbps: finalMbps, bytes: totalBytes };
        } else {
          console.error("[Upload] No data sent, timeout/error");
          throw new Error("Upload timeout - no data transferred");
        }
      } else if (error instanceof DOMException && error.name === "AbortError") {
        if (totalBytes > 0) {
          const finalElapsedMs = performance.now() - startTime;
          const finalElapsedSec = finalElapsedMs / 1000;
          const finalMbps = (totalBytes * 8) / (finalElapsedSec * 1_000_000);
          onProgress(finalMbps);
          return { mbps: finalMbps, bytes: totalBytes };
        } else {
          throw new Error("Test cancelled");
        }
      } else if (error instanceof TypeError && error.message.includes("fetch")) {
        console.error("[Upload] Network error:", error);
        throw new Error("Internet se connect nahi ho pa raha. Wi-Fi/data check karke dobara try karo.");
      } else {
        console.error("[Upload] Error:", error);
        throw error;
      }
    }
  };

  // Run upload at least once
  const firstResult = await runUpload();
  let finalMbps = firstResult.mbps;
  const totalElapsedMs = performance.now() - startTime;

  // If completed too fast (< 2s), repeat until we reach minimum duration
  while (totalElapsedMs < minDurationMs) {
    if (signal?.aborted) throw new Error("Test cancelled");
    totalBytes = 0; // Reset for next iteration
    lastProgressTime = performance.now();
    const additionalResult = await runUpload();
    // Weighted average favoring the latest measurement
    finalMbps = (finalMbps + additionalResult.mbps) / 2;
  }

  return finalMbps;
}