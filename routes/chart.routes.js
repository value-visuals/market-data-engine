
import express from "express";

const router = express.Router();

router.get("/:symbol", (req, res) => {
  const symbol = String(req.params.symbol)
    .trim()
    .toUpperCase();

  const supportedSymbols = ["BTC", "ETH", "XMR", "XAU", "XAG"];

  if (!supportedSymbols.includes(symbol)) {
    return res.status(404).send("Unsupported market symbol");
  }

  res.send(`
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8" />

        <meta
          name="viewport"
          content="width=device-width, initial-scale=1.0"
        />

        <title>${symbol} Market Chart</title>

        <!-- Chart.js -->
        <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>

        <!-- Luxon -->
        <script src="https://cdn.jsdelivr.net/npm/luxon@3"></script>

        <!-- Chart.js Luxon time adapter -->
        <script src="https://cdn.jsdelivr.net/npm/chartjs-adapter-luxon@1"></script>

        <style>
          body {
            margin: 0;
            padding: 24px;
            background: #111827;
            color: white;
            font-family: Arial, sans-serif;
          }

          h1 {
            max-width: 1200px;
            margin: 0 auto 20px;
          }

          .toolbar {
            max-width: 1200px;
            margin: 0 auto 20px;
            display: flex;
            gap: 8px;
            flex-wrap: wrap;
            align-items: center;
          }

          button,
          #currency {
            padding: 8px 14px;
            border: 1px solid #374151;
            border-radius: 6px;
            background: #1f2937;
            color: white;
            cursor: pointer;
            font-size: 14px;
          }

          button:hover,
          #currency:hover {
            background: #374151;
          }

          button.active {
            background: #2563eb;
            border-color: #3b82f6;
          }

          .chart-container {
            max-width: 1200px;
            height: 600px;
            margin: 0 auto;
          }

          .status {
            max-width: 1200px;
            margin: 0 auto 12px;
            color: #9ca3af;
            font-size: 14px;
          }

          .error {
            color: #ef4444;
          }
        </style>
      </head>

      <body>
        <h1>${symbol}</h1>

        <div class="toolbar">
          <button data-range="1D">1D</button>
          <button data-range="2D">2D</button>
          <button data-range="3D">3D</button>
          <button data-range="7D">7D</button>
          <button data-range="14D">14D</button>
          <button data-range="1M">1M</button>
          <button data-range="2M">2M</button>
          <button data-range="3M">3M</button>
          <button data-range="6M">6M</button>
          <button data-range="1Y">1Y</button>

          <select id="currency" aria-label="Quote currency">
            <option value="USD">USD</option>
            <option value="EUR">EUR</option>
            <option value="GBP">GBP</option>
          </select>
        </div>

        <div id="status" class="status">
          Loading...
        </div>

        <div class="chart-container">
          <canvas id="chart"></canvas>
        </div>

        <script>
          const symbol = "${symbol}";

          const supportedCurrencies = ["USD", "EUR", "GBP"];
          const isMetal = ["XAU", "XAG"].includes(symbol);

          const statusElement = document.getElementById("status");
          const currencySelector = document.getElementById("currency");
          const rangeButtons = document.querySelectorAll("[data-range]");

          let chart = null;
          let candles = [];
          let currentRange = "1D";
          let requestController = null;

          /**
           * Initialize currency from URL.
           */
          const urlParams = new URLSearchParams(
            window.location.search
          );

          let currentCurrency = String(
            urlParams.get("currency") || "USD"
          ).trim().toUpperCase();

          if (
            !supportedCurrencies.includes(currentCurrency) ||
            isMetal
          ) {
            currentCurrency = "USD";
          }

          currencySelector.value = currentCurrency;

          /**
           * Gold and silver currently support USD only.
           */
          if (isMetal) {
            currencySelector.disabled = true;
            currencySelector.title = "USD only";
          }

          /**
           * Calculate the requested date range.
           * Preserve existing range calculations.
           */
          function getStartDate(range) {
            const end = new Date();
            const start = new Date(end);

            switch (range) {
              case "1D":
                start.setDate(start.getDate() - 1);
                break;

              case "2D":
                start.setDate(start.getDate() - 2);
                break;

              case "3D":
                start.setDate(start.getDate() - 3);
                break;

              case "7D":
                start.setDate(start.getDate() - 7);
                break;

              case "14D":
                start.setDate(start.getDate() - 14);
                break;

              case "1M":
                start.setMonth(start.getMonth() - 1);
                break;

              case "2M":
                start.setMonth(start.getMonth() - 2);
                break;

              case "3M":
                start.setMonth(start.getMonth() - 3);
                break;

              case "6M":
                start.setMonth(start.getMonth() - 6);
                break;

              case "1Y":
                start.setFullYear(start.getFullYear() - 1);
                break;

              default:
                throw new Error("Unsupported range: " + range);
            }

            return {
              start: start.toISOString(),
              end: end.toISOString()
            };
          }

          /**
           * Convert timestamps into milliseconds.
           *
           * Supports:
           * - Millisecond timestamps
           * - Second timestamps
           * - Numeric strings
           * - ISO date strings
           * - Firestore Timestamp-like objects
           * - Firestore _seconds/_nanoseconds
           * - toMillis() and toDate()
           */
          function normalizeTimestamp(value) {
            if (value === null || value === undefined) {
              return null;
            }

            if (
              typeof value === "number" &&
              Number.isFinite(value)
            ) {
              return value < 10_000_000_000
                ? value * 1000
                : value;
            }

            if (typeof value === "string") {
              const numeric = Number(value);

              if (value.trim() && Number.isFinite(numeric)) {
                return numeric < 10_000_000_000
                  ? numeric * 1000
                  : numeric;
              }

              const parsed = Date.parse(value);

              return Number.isFinite(parsed)
                ? parsed
                : null;
            }

            if (typeof value === "object") {
              if (Number.isFinite(value.seconds)) {
                return (
                  Number(value.seconds) * 1000 +
                  Math.floor(
                    Number(value.nanoseconds || 0) / 1_000_000
                  )
                );
              }

              if (Number.isFinite(value._seconds)) {
                return (
                  Number(value._seconds) * 1000 +
                  Math.floor(
                    Number(value._nanoseconds || 0) / 1_000_000
                  )
                );
              }

              if (typeof value.toMillis === "function") {
                const milliseconds = value.toMillis();

                if (Number.isFinite(milliseconds)) {
                  return milliseconds;
                }
              }

              if (typeof value.toDate === "function") {
                const date = value.toDate();
                const milliseconds = date.getTime();

                if (Number.isFinite(milliseconds)) {
                  return milliseconds;
                }
              }
            }

            return null;
          }

          /**
           * Normalize Firebase candles.
           *
           * Retain full OHLCV data for tooltips.
           * Remove duplicate timestamps.
           * Sort chronologically.
           */
          function normalizeCandles(input) {
            if (!Array.isArray(input)) {
              return [];
            }

            const unique = new Map();

            for (const candle of input) {
              if (!candle || typeof candle !== "object") {
                continue;
              }

              const timestamp = normalizeTimestamp(
                candle.timestamp
              );

              const close = Number(candle.close);

              if (
                timestamp === null ||
                !Number.isFinite(close)
              ) {
                continue;
              }

              unique.set(timestamp, {
                ...candle,
                timestamp,
                close
              });
            }

            return Array.from(unique.values()).sort(
              (a, b) => a.timestamp - b.timestamp
            );
          }

          /**
           * Chart.js time-series data.
           *
           * Real timestamps are used as x coordinates.
           * No artificial labels or equal spacing.
           */
          function createChartData() {
            return candles.map(candle => ({
              x: candle.timestamp,
              y: candle.close
            }));
          }

          /**
           * Format values using the selected currency.
           */
          function formatPrice(value) {
            const number = Number(value);

            if (!Number.isFinite(number)) {
              return "N/A";
            }

            return new Intl.NumberFormat(undefined, {
              style: "currency",
              currency: currentCurrency,
              maximumFractionDigits: 2
            }).format(number);
          }

          /**
           * Render the chart.
           * Preserve original Chart.js styling.
           */
          function renderChart() {
            const canvas = document.getElementById("chart");

            if (chart) {
              chart.destroy();
              chart = null;
            }

            const data = createChartData();

            chart = new Chart(canvas, {
              type: "line",

              data: {
                datasets: [
                  {
                    label: symbol + "/" + currentCurrency + " Close",

                    data,

                    borderColor: "#22c55e",
                    backgroundColor: "rgba(34, 197, 94, 0.10)",

                    borderWidth: 2,

                    pointRadius: 0,
                    pointHoverRadius: 5,

                    tension: 0,
                    fill: true,

                    parsing: false
                  }
                ]
              },

              options: {
                responsive: true,
                maintainAspectRatio: false,

                interaction: {
                  mode: "nearest",
                  intersect: false
                },

                plugins: {
                  tooltip: {
                    enabled: true,

                    callbacks: {
                      title: function(context) {
                        if (!context.length) {
                          return "";
                        }

                        const index = context[0].dataIndex;
                        const candle = candles[index];

                        if (!candle) {
                          return "";
                        }

                        return new Date(
                          candle.timestamp
                        ).toLocaleString();
                      },

                      label: function(context) {
                        const index = context.dataIndex;
                        const candle = candles[index];

                        if (!candle) {
                          return "";
                        }

                        return [
                          "Open: " + (
                            candle.open == null
                              ? "N/A"
                              : formatPrice(candle.open)
                          ),
                          "High: " + (
                            candle.high == null
                              ? "N/A"
                              : formatPrice(candle.high)
                          ),
                          "Low: " + (
                            candle.low == null
                              ? "N/A"
                              : formatPrice(candle.low)
                          ),
                          "Close: " + formatPrice(candle.close),
                          "Volume: " + (
                            candle.volume ?? "N/A"
                          )
                        ];
                      }
                    }
                  },

                  legend: {
                    labels: {
                      color: "#ffffff"
                    }
                  }
                },

                scales: {
                  x: {
                    type: "time",

                    time: {
                      tooltipFormat: "MMM d, yyyy HH:mm"
                    },

                    ticks: {
                      color: "#9ca3af",
                      maxRotation: 0,
                      autoSkip: true
                    },

                    grid: {
                      color: "rgba(156, 163, 175, 0.1)"
                    }
                  },

                  y: {
                    ticks: {
                      color: "#9ca3af",

                      callback: function(value) {
                        return Number(value).toLocaleString(
                          undefined,
                          {
                            maximumFractionDigits: 2
                          }
                        );
                      }
                    },

                    grid: {
                      color: "rgba(156, 163, 175, 0.1)"
                    }
                  }
                }
              }
            });
          }

          /**
           * Keep selected range button highlighted.
           */
          function updateActiveRange() {
            rangeButtons.forEach(button => {
              button.classList.toggle(
                "active",
                button.dataset.range === currentRange
              );
            });
          }

          /**
           * Synchronize currency with browser URL.
           */
          function updateCurrencyUrl() {
            const url = new URL(window.location.href);

            url.searchParams.set(
              "currency",
              currentCurrency
            );

            window.history.replaceState(
              {},
              "",
              url.pathname + url.search + url.hash
            );
          }

          /**
           * Load market data from the API.
           *
           * Currency and date range are independent.
           * Abort prior requests to avoid stale responses.
           */
          async function loadChart(range = currentRange) {
            currentRange = range;
            updateActiveRange();

            if (requestController) {
              requestController.abort();
            }

            const controller = new AbortController();
            requestController = controller;

            statusElement.classList.remove("error");
            statusElement.textContent = "Loading...";

            try {
              const dates = getStartDate(currentRange);

              const params = new URLSearchParams({
                currency: currentCurrency,
                start: dates.start,
                end: dates.end
              });

              const response = await fetch(
                "/api/market-data/" +
                  encodeURIComponent(symbol) +
                  "?" +
                  params.toString(),
                {
                  signal: controller.signal
                }
              );

              if (!response.ok) {
                throw new Error(
                  "Failed to load market data: " +
                  response.status
                );
              }

              const result = await response.json();

              if (controller.signal.aborted) {
                return;
              }

              /**
               * Normalize candles and preserve OHLCV.
               */
              candles = normalizeCandles(
                result.candles || []
              );

              if (candles.length === 0) {
                if (chart) {
                  chart.destroy();
                  chart = null;
                }

                statusElement.textContent =
                  "No market data found for " +
                  symbol +
                  "/" +
                  currentCurrency +
                  " over " +
                  currentRange +
                  ".";

                return;
              }

              renderChart();

              const first = candles[0];
              const last = candles[candles.length - 1];

              const firstDate = new Date(
                first.timestamp
              ).toLocaleString();

              const lastDate = new Date(
                last.timestamp
              ).toLocaleString();

              statusElement.textContent =
                candles.length +
                " data points | " +
                firstDate +
                " → " +
                lastDate;
            } catch (error) {
              if (error.name === "AbortError") {
                return;
              }

              console.error(
                "[market-data.chart] Failed to load chart:",
                error
              );

              if (chart) {
                chart.destroy();
                chart = null;
              }

              candles = [];

              statusElement.classList.add("error");
              statusElement.textContent =
                "Failed to load market data.";
            } finally {
              if (requestController === controller) {
                requestController = null;
              }
            }
          }

          /**
           * Currency selector.
           *
           * Preserve range when currency changes.
           */
          currencySelector.addEventListener(
            "change",
            () => {
              currentCurrency = currencySelector.value;

              updateCurrencyUrl();
              loadChart(currentRange);
            }
          );

          /**
           * Date range buttons.
           *
           * Preserve currency when range changes.
           */
          rangeButtons.forEach(button => {
            button.addEventListener("click", () => {
              loadChart(button.dataset.range);
            });
          });

          /**
           * Initial chart load.
           */
          loadChart(currentRange);
        </script>
      </body>
    </html>
  `);
});

export default router;
