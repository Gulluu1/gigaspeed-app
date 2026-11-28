"use client";

import { useState, useCallback, useRef } from "react";
import { measurePing, measureDownload, measureUpload, getHistory, saveHistory, clearHistory, getRating, type HistoryEntry } from "@/lib/speedtest";
import SpeedometerGauge from "@/components/SpeedometerGauge";

interface SpeedResult {
  download: number | null;
  upload: number | null;
  ping: number | null;
}

type TestStep = "idle" | "ping" | "download" | "upload" | "complete" | "error";

interface TestState {
  step: TestStep;
  errorMessage: string;
  serverStatus: string;
  ispInfo: string;
}

const STEP_TIMEOUT = 30000; // 30 seconds per step

export default function Home() {
  const [results, setResults] = useState<SpeedResult>({
    download: null,
    upload: null,
    ping: null,
  });
  const [testState, setTestState] = useState<TestState>({
    step: "idle",
    errorMessage: "",
    serverStatus: "Server: Cloudflare Speed Test",
    ispInfo: "",
  });
  const [history, setHistory] = useState<HistoryEntry[]>(() => getHistory());
  const [gaugeSpeed, setGaugeSpeed] = useState(0);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const clearTimeoutRef = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const abortCurrentTest = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    clearTimeoutRef();
  }, [clearTimeoutRef]);

  const withTimeout = <T,>(promise: Promise<T>, ms: number, signal: AbortSignal): Promise<T> => {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error(`Step timeout (${ms / 1000}s)`));
        }, ms);
        signal.addEventListener("abort", () => clearTimeout(timeout));
      }),
    ]);
  };

  const handleStartTest = async () => {
    abortCurrentTest();
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    setResults({ download: null, upload: null, ping: null });
    setGaugeSpeed(0);
    setTestState({
      step: "ping",
      errorMessage: "",
      serverStatus: "Server se connect ho raha hai...",
      ispInfo: "",
    });

    // Fetch ISP info in background
    fetch("https://speed.cloudflare.com/meta", { signal })
      .then((r) => r.json())
      .then((data) => {
        if (!signal.aborted) {
          const isp = data.asOrganization || data.isp || "";
          const city = data.city || "";
          const region = data.region || "";
          const country = data.country || "";
          if (isp || city || region || country) {
            const parts = [isp, city, region, country].filter(Boolean);
            setTestState((prev) => ({ ...prev, ispInfo: parts.join(" • ") }));
          }
        }
      })
      .catch(() => {
        // Ignore meta fetch errors
      });

    try {
      // Step 1: Ping (fresh measurement every test)
      const pingResult = await withTimeout(measurePing(signal), STEP_TIMEOUT, signal);
      if (signal.aborted) return;

      setResults((prev) => ({ ...prev, ping: pingResult.ping }));
      setTestState((prev) => ({ ...prev, serverStatus: "Server: Cloudflare Speed Test" }));

      // Step 2: Download
      setTestState((prev) => ({ ...prev, step: "download" }));
      setGaugeSpeed(0);

      const downloadMbps = await withTimeout(
        measureDownload((liveMbps) => {
          if (signal.aborted) return;
          setGaugeSpeed(liveMbps);
        }, signal),
        STEP_TIMEOUT,
        signal
      );
      if (signal.aborted) return;

      setResults((prev) => ({ ...prev, download: downloadMbps }));

      // Step 3: Upload
      setTestState((prev) => ({ ...prev, step: "upload" }));
      setGaugeSpeed(0);

      const uploadMbps = await withTimeout(
        measureUpload((liveMbps) => {
          if (signal.aborted) return;
          setGaugeSpeed(liveMbps);
        }, signal),
        STEP_TIMEOUT,
        signal
      );
      if (signal.aborted) return;

      setResults((prev) => ({ ...prev, upload: uploadMbps }));

      // Test complete - save to history
      const newHistory = saveHistory({
        timestamp: Date.now(),
        download: downloadMbps,
        upload: uploadMbps,
        ping: pingResult.ping,
      });
      setHistory(newHistory);

      setTestState((prev) => ({ ...prev, step: "complete" }));
    } catch (error) {
      if (signal.aborted) return;
      const message = error instanceof Error ? error.message : "Test failed";

      // If error happens during upload and we have download/ping results,
      // show specific upload error but keep results and go back to idle
      if (testState.step === "upload" && results.download !== null && results.ping !== null) {
        setTestState((prev) => ({
          ...prev,
          step: "idle",
          errorMessage: "Upload measure nahi ho paya, Download aur Ping upar dekh lo",
        }));
      } else {
        setTestState((prev) => ({
          ...prev,
          step: "error",
          errorMessage: message,
        }));
      }
    }
  };

  const handleClearHistory = () => {
    clearHistory();
    setHistory([]);
  };

  const formatTimestamp = (timestamp: number): string => {
    const date = new Date(timestamp);
    return date.toLocaleString("hi-IN", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const isTesting = testState.step === "ping" || testState.step === "download" || testState.step === "upload";

  const getStepLabel = () => {
    switch (testState.step) {
      case "download":
        return "DOWNLOAD Mbps";
      case "upload":
        return "UPLOAD Mbps";
      case "ping":
        return "MEASURING PING...";
      default:
        return "SPEED Mbps";
    }
  };

  return (
    <div className="min-h-screen gigaspeed-bg flex flex-col">
      {/* Header */}
      <header className="py-8 px-4 text-center">
        <h1 className="gradient-text text-3xl md:text-4xl lg:text-5xl font-bold tracking-tight">
          GigaSpeed
        </h1>
        <p className="mt-2 text-base md:text-lg text-gray-600 dark:text-gray-300 max-w-md mx-auto">
          Apne internet ki asli speed check karo
        </p>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex flex-col items-center justify-start px-4 py-6">
        <div className="w-full max-w-4xl flex flex-col items-center gap-8">

          {/* Speedometer Gauge with Center GO Button */}
          <SpeedometerGauge
            speed={gaugeSpeed}
            maxSpeed={1000}
            label={getStepLabel()}
            size={380}
            isTesting={isTesting}
            onStartTest={handleStartTest}
          />

          {/* Server & ISP Status Lines */}
          <div className="w-full max-w-md text-center space-y-1">
            <p className={`text-sm font-mono transition-colors duration-300 ${
              testState.step === "ping" ? "text-violet-600 dark:text-violet-400" : "text-slate-500 dark:text-slate-400"
            }`}>
              {testState.serverStatus}
            </p>
            {testState.ispInfo && (
              <p className="text-xs font-mono text-slate-400 dark:text-slate-500">
                {testState.ispInfo}
              </p>
            )}
            {(testState.step === "error" || (testState.step === "idle" && testState.errorMessage)) && (
              <p className="text-sm text-red-600 dark:text-red-400 mt-1">
                {testState.errorMessage}
              </p>
            )}
          </div>

          {/* Result Cards - Download / Upload / Ping */}
          <div className="w-full grid grid-cols-3 gap-3 sm:gap-4">
            {/* Download Result Card */}
            <div className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm rounded-2xl p-4 download-accent shadow-lg shadow-blue-500/10 border border-gray-100 dark:border-gray-800 min-w-0">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-2.5 h-2.5 rounded-full bg-sky-500" />
                <span className="text-xs font-medium text-gray-600 dark:text-gray-300 uppercase tracking-wider">
                  DOWNLOAD
                </span>
              </div>
              <div className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white tabular-nums">
                {results.download !== null ? results.download.toFixed(1) : "—"}
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400">Mbps</div>
            </div>

            {/* Upload Result Card */}
            <div className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm rounded-2xl p-4 upload-accent shadow-lg shadow-green-500/10 border border-gray-100 dark:border-gray-800 min-w-0">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                <span className="text-xs font-medium text-gray-600 dark:text-gray-300 uppercase tracking-wider">
                  UPLOAD
                </span>
              </div>
              <div className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white tabular-nums">
                {results.upload !== null ? results.upload.toFixed(1) : "—"}
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400">Mbps</div>
            </div>

            {/* Ping Result Card */}
            <div className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm rounded-2xl p-4 ping-accent shadow-lg shadow-amber-500/10 border border-gray-100 dark:border-gray-800 min-w-0">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                <span className="text-xs font-medium text-gray-600 dark:text-gray-300 uppercase tracking-wider">
                  PING
                </span>
              </div>
              <div className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white tabular-nums">
                {results.ping !== null ? results.ping.toFixed(0) : "—"}
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400">ms</div>
            </div>
          </div>

          {/* Final Result Summary */}
          {testState.step === "complete" && results.download !== null && results.upload !== null && results.ping !== null && (
            <div className="w-full max-w-4xl">
              <div className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm rounded-2xl p-6 shadow-xl border border-gray-100 dark:border-gray-800">
                <div className="text-center mb-6">
                  <p className="text-lg font-semibold text-gray-900 dark:text-white mb-3">
                    Test Result Summary
                  </p>
                  <div className="grid grid-cols-3 gap-4 mb-6">
                    <div className="p-4 bg-sky-50 dark:bg-sky-900/20 rounded-xl">
                      <p className="text-xs font-medium text-sky-600 dark:text-sky-400 uppercase tracking-wider mb-1">DOWNLOAD</p>
                      <p className="text-3xl font-bold text-gray-900 dark:text-white">{results.download.toFixed(1)}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">Mbps</p>
                    </div>
                    <div className="p-4 bg-emerald-50 dark:bg-emerald-900/20 rounded-xl">
                      <p className="text-xs font-medium text-emerald-600 dark:text-emerald-400 uppercase tracking-wider mb-1">UPLOAD</p>
                      <p className="text-3xl font-bold text-gray-900 dark:text-white">{results.upload.toFixed(1)}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">Mbps</p>
                    </div>
                    <div className="p-4 bg-amber-50 dark:bg-amber-900/20 rounded-xl">
                      <p className="text-xs font-medium text-amber-600 dark:text-amber-400 uppercase tracking-wider mb-1">PING</p>
                      <p className="text-3xl font-bold text-gray-900 dark:text-white">{results.ping.toFixed(0)}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">ms</p>
                    </div>
                  </div>
                  <p className="text-2xl font-bold text-violet-600 dark:text-violet-400">
                    {getRating(results.download)}
                  </p>
                </div>
              </div>

              {/* History List */}
              {history.length > 0 && (
                <div className="mt-6 w-full max-w-4xl">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Pichle Tests</h3>
                    <button
                      onClick={handleClearHistory}
                      className="text-sm text-red-600 dark:text-red-400 hover:underline self-start sm:self-auto"
                    >
                      History saaf karo
                    </button>
                  </div>
                  <div className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm rounded-2xl p-4 shadow-lg border border-gray-100 dark:border-gray-800 space-y-2">
                    {history.map((entry) => (
                      <div key={entry.id} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 p-3 bg-gray-50 dark:bg-gray-800/50 rounded-xl">
                        <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-sm text-gray-700 dark:text-gray-300">
                          <span className="font-medium text-sky-600 dark:text-sky-400">↓ {entry.download.toFixed(1)} Mbps</span>
                          <span className="font-medium text-emerald-600 dark:text-emerald-400">↑ {entry.upload.toFixed(1)} Mbps</span>
                          <span className="font-medium text-amber-600 dark:text-amber-400">{entry.ping.toFixed(0)} ms</span>
                          <span className="text-gray-500 dark:text-gray-400">{formatTimestamp(entry.timestamp)}</span>
                        </div>
                        <span className="text-sm font-medium text-violet-600 dark:text-violet-400">
                          {getRating(entry.download)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="py-6 px-4 text-center text-sm text-gray-500 dark:text-gray-400">
        Powered by Cloudflare Speed Test API
      </footer>
    </div>
  );
}