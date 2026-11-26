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
}

const STEP_TIMEOUT = 15000; // 15 seconds per step

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
          reject(new Error("Step timeout (15s)"));
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
      setTestState((prev) => ({
        ...prev,
        step: "error",
        errorMessage: message,
      }));
    }
  };

  const handleRetry = () => {
    abortCurrentTest();
    setResults({ download: null, upload: null, ping: null });
    setGaugeSpeed(0);
    setTestState({
      step: "idle",
      errorMessage: "",
      serverStatus: "Server: Cloudflare Speed Test",
    });
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

  const getButtonText = () => {
    if (testState.step === "ping" || testState.step === "download" || testState.step === "upload") return "Testing...";
    if (testState.step === "complete") return "Dobara Test Karo";
    if (testState.step === "error") return "Retry";
    return "START";
  };

  const isButtonDisabled = testState.step !== "idle" && testState.step !== "complete" && testState.step !== "error";

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
        <div className="w-full max-w-4xl flex flex-col items-center gap-6">

          {/* Top Metrics Row */}
          <div className="w-full grid grid-cols-3 gap-3 sm:gap-4">
            {/* Ping Card */}
            <div className={`bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm rounded-2xl p-4 shadow-lg border-2 transition-all duration-300 ${
              testState.step === "ping" ? "border-amber-400 shadow-amber-500/20" : "border-gray-100 dark:border-gray-800"
            }`}>
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

            {/* Download Card */}
            <div className={`bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm rounded-2xl p-4 shadow-lg border-2 transition-all duration-300 ${
              testState.step === "download" ? "border-sky-400 shadow-sky-500/20" : "border-gray-100 dark:border-gray-800"
            }`}>
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

            {/* Upload Card */}
            <div className={`bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm rounded-2xl p-4 shadow-lg border-2 transition-all duration-300 ${
              testState.step === "upload" ? "border-emerald-400 shadow-emerald-500/20" : "border-gray-100 dark:border-gray-800"
            }`}>
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
          </div>

          {/* Speedometer Gauge */}
          <div className="w-full flex flex-col items-center gap-4">
            <SpeedometerGauge
              speed={gaugeSpeed}
              maxSpeed={1000}
              label={getStepLabel()}
              size={360}
            />

            {/* Server Status Line */}
            <div className="w-full max-w-md text-center">
              <p className={`text-sm font-mono transition-colors duration-300 ${
                testState.step === "ping" ? "text-violet-600 dark:text-violet-400" : "text-slate-500 dark:text-slate-400"
              }`}>
                {testState.serverStatus}
              </p>
            </div>

            {/* START Button */}
            <button
              onClick={handleStartTest}
              disabled={isButtonDisabled}
              className="gradient-btn text-white px-10 py-4 rounded-full text-lg font-semibold shadow-lg shadow-violet-500/30 hover:shadow-violet-500/50 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:shadow-none focus:outline-none focus:ring-4 focus:ring-violet-500/30 min-w-[220px] w-full sm:w-auto"
            >
              {getButtonText()}
            </button>

            {/* Error Message */}
            {testState.step === "error" && (
              <div className="w-full max-w-md text-center p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl">
                <p className="text-red-700 dark:text-red-300 mb-3 text-sm">
                  {testState.errorMessage}
                </p>
                <button
                  onClick={handleRetry}
                  className="gradient-btn text-white px-6 py-2 rounded-full font-medium hover:opacity-90 transition-opacity"
                >
                  Try again
                </button>
              </div>
            )}
          </div>

          {/* Result Cards - Always visible at bottom */}
          <div className="w-full grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 mt-4">
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
            <div className="w-full max-w-4xl mt-6">
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