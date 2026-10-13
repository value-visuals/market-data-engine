
import express from "express";

const router = express.Router();

router.get("/:symbol", (req, res) => {
  const symbol = String(req.params.symbol).trim().toUpperCase();
  const supportedSymbols = ["BTC", "ETH", "XMR", "XAU", "XAG"];

  if (!supportedSymbols.includes(symbol)) {
    return res.status(404).send("Unsupported market symbol");
  }

  res.send(`
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>${symbol}/USD Market Chart</title>

        <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
        <script src="https://cdn.jsdelivr.net/npm/luxon@3"></script>
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

          button {
            padding: 8px 14px;
            border: 1px solid #374151;
            border-radius: 6px;
            background: #1f2937;
            color: white;
            cursor: pointer;
            font-size: 14px;
          }

          button:hover:not(:disabled) {
            background: #374151;
          }

          button.active,
          button.active:hover {
            background: #2563eb;
            border-color: #3b82f6;
          }

          button:disabled {
            opacity: 0.4;
            cursor: not-allowed;
          }

          .price-summary {
            max-width: 1200px;
            margin: 0 auto 20px;
          }

          .current-price {
            font-size: clamp(28px, 5vw, 38px);
            font-weight: 700;
            font-variant-numeric: tabular-nums;
          }

          .price-change {
            margin-top: 6px;
            font-size: 16px;
            font-variant-numeric: tabular-nums;
          }

          .price-time {
            margin-top: 6px;
            color: #9ca3af;
            font-size: 12px;
          }

          .positive { color: #22c55e; }
          .negative { color: #ef4444; }
          .neutral { color: #9ca3af; }

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
        <h1 id="chart-title">${symbol}/USD</h1>

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

          <button data-currency="USD">USD</button>
          <button data-currency="EUR">EUR</button>
          <button data-currency="GBP">GBP</button>
        </div>

        <div class="price-summary" aria-live="polite">
          <div id="current-price" class="current-price neutral">
            Loading price...
          </div>
          <div id="price-change" class="price-change neutral">
            24h change: —
          </div>
          <div id="price-time" class="price-time"></div>
        </div>

        <div id="status" class="status">Loading...</div>

        <div class="chart-container">
          <canvas id="chart"></canvas>
        </div>

        <script>
          const symbol = "${symbol}";
          const supportedCurrencies = ["USD", "EUR", "GBP"];
          const isMetal = ["XAU", "XAG"].includes(symbol);

          const rangeButtons = document.querySelectorAll("[data-range]");
          const currencyButtons = document.querySelectorAll("[data-currency]");
          const statusElement = document.getElementById("status");
          const titleElement = document.getElementById("chart-title");
          const priceElement = document.getElementById("current-price");
          const changeElement = document.getElementById("price-change");
          const priceTimeElement = document.getElementById("price-time");

          const urlParams = new URLSearchParams(window.location.search);

          let currentCurrency = String(
            urlParams.get("currency") || "USD"
          ).trim().toUpperCase();

          if (!supportedCurrencies.includes(currentCurrency) || isMetal) {
            currentCurrency = "USD";
          }

          let chart = null;
          let candles = [];
          let currentRange = "1D";
          let chartController = null;
          let priceController = null;

          /**
           * Update page heading and browser tab title.
           */
          function updateChartTitle() {
            const marketPair = symbol + "/" + currentCurrency;

            titleElement.textContent = marketPair;
            document.title = marketPair + " Market Chart";
          }

          /**
           * Highlight selected currency and disable
           * unsupported currency options for metals.
           */
          function updateActiveCurrency() {
            currencyButtons.forEach(button => {
              const currency = button.dataset.currency;
              const disabled = isMetal && currency !== "USD";

              button.disabled = disabled;
              button.title = disabled ? "USD only" : "";
              button.classList.toggle(
                "active",
                currency === currentCurrency
              );
              button.setAttribute(
                "aria-pressed",
                String(currency === currentCurrency)
              );
            });
          }

          /**
           * Highlight the selected date range.
           */
          function updateActiveRange() {
            rangeButtons.forEach(button => {
              button.classList.toggle(
                "active",
                button.dataset.range === currentRange
              );
              button.setAttribute(
                "aria-pressed",
                String(button.dataset.range === currentRange)
              );
            });
          }

          /**
           * Calculate the requested date range.
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
           * Normalize Firebase timestamps into milliseconds.
           */
          function normalizeTimestamp(value) {
            if (value === null || value === undefined) return null;

            if (
              typeof value === "number" &&
              Number.isFinite(value)
            ) {
              return value < 10_000_000_000 ? value * 1000 : value;
            }

            if (typeof value === "string") {
              const numeric = Number(value);

              if (value.trim() && Number.isFinite(numeric)) {
                return numeric < 10_000_000_000
                  ? numeric * 1000
                  : numeric;
              }

              const parsed = Date.parse(value);
              return Number.isFinite(parsed) ? parsed : null;
            }

            if (typeof value === "object") {
              if (Number.isFinite(value.seconds)) {
                return Number(value.seconds) * 1000 +
                  Math.floor(
                    Number(value.nanoseconds || 0) / 1_000_000
                  );
              }

              if (Number.isFinite(value._seconds)) {
                return Number(value._seconds) * 1000 +
                  Math.floor(
                    Number(value._nanoseconds || 0) / 1_000_000
                  );
              }

              if (typeof value.toMillis === "function") {
                const ms = value.toMillis();
                if (Number.isFinite(ms)) return ms;
              }

              if (typeof value.toDate === "function") {
                const ms = value.toDate().getTime();
                if (Number.isFinite(ms)) return ms;
              }
            }

            return null;
          }

          /**
           * Normalize Firebase candle data.
           * Remove duplicates and sort chronologically.
           */
          function normalizeCandles(input) {
            if (!Array.isArray(input)) return [];

            const unique = new Map();

            for (const candle of input) {
              if (!candle || typeof candle !== "object") continue;

              const timestamp = normalizeTimestamp(candle.timestamp);
              const close = Number(candle.close);

              if (
                timestamp === null ||
                !Number.isFinite(close)
              ) continue;

              unique.set(timestamp, {
                ...candle,
                timestamp,
                close
              });
            }

            return Array.from(unique.values())
              .sort((a, b) => a.timestamp - b.timestamp);
          }

          /**
           * Format price in the selected currency.
           */
          function formatPrice(value) {
            const number = Number(value);

            if (!Number.isFinite(number)) return "N/A";

            return new Intl.NumberFormat(undefined, {
              style: "currency",
              currency: currentCurrency,
              maximumFractionDigits: 2
            }).format(number);
          }

          /**
           * Render the market chart.
           */
          function renderChart() {
            const canvas = document.getElementById("chart");

            if (chart) {
              chart.destroy();
              chart = null;
            }

            chart = new Chart(canvas, {
              type: "line",

              data: {
                datasets: [{
                  label: symbol + "/" + currentCurrency + " Close",
                  data: candles.map(candle => ({
                    x: candle.timestamp,
                    y: candle.close
                  })),
                  borderColor: "#22c55e",
                  backgroundColor: "rgba(34, 197, 94, 0.10)",
                  borderWidth: 2,
                  pointRadius: 0,
                  pointHoverRadius: 5,
                  tension: 0,
                  fill: true,
                  parsing: false
                }]
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
                        if (!context.length) return "";

                        const candle = candles[context[0].dataIndex];

                        return candle
                          ? new Date(candle.timestamp).toLocaleString()
                          : "";
                      },

                      label: function(context) {
                        const candle = candles[context.dataIndex];

                        if (!candle) return "";

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
                          "Volume: " + (candle.volume ?? "N/A")
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
                          { maximumFractionDigits: 2 }
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
           * Build API URL for currency and date range.
           */
          function getMarketUrl(start, end) {
            const params = new URLSearchParams({
              currency: currentCurrency,
              start: start.toISOString(),
              end: end.toISOString()
            });

            return "/api/market-data/" +
              encodeURIComponent(symbol) +
              "?" +
              params.toString();
          }

          /**
           * Load chart data independently of price summary.
           */
          async function loadChart(range = currentRange) {
            currentRange = range;
            updateActiveRange();

            if (chartController) chartController.abort();

            const controller = new AbortController();
            chartController = controller;

            statusElement.classList.remove("error");
            statusElement.textContent = "Loading...";

            try {
              const dates = getStartDate(currentRange);

              const response = await fetch(
                getMarketUrl(
                  new Date(dates.start),
                  new Date(dates.end)
                ),
                { signal: controller.signal }
              );

              if (!response.ok) {
                throw new Error(
                  "Failed to load market data: " + response.status
                );
              }

              const result = await response.json();

              if (controller.signal.aborted) return;

              candles = normalizeCandles(result.candles || []);

              if (!candles.length) {
                if (chart) {
                  chart.destroy();
                  chart = null;
                }

                statusElement.textContent =
                  "No market data found for " +
                  symbol + "/" + currentCurrency +
                  " over " + currentRange + ".";

                return;
              }

              renderChart();

              statusElement.textContent =
                candles.length + " data points | " +
                new Date(candles[0].timestamp).toLocaleString() +
                " → " +
                new Date(
                  candles[candles.length - 1].timestamp
                ).toLocaleString();

            } catch (error) {
              if (controller.signal.aborted) return;

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
              statusElement.textContent = "Failed to load market data.";

            } finally {
              if (chartController === controller) {
                chartController = null;
              }
            }
          }

          /**
           * Latest stored price and 24-hour comparison.
           * Independent of selected chart range.
           */
          async function loadPriceSummary() {
            if (priceController) priceController.abort();

            const controller = new AbortController();
            priceController = controller;

            priceElement.className = "current-price neutral";
            priceElement.textContent = "Loading price...";
            changeElement.className = "price-change neutral";
            changeElement.textContent = "24h change: —";
            priceTimeElement.textContent = "";

            try {
              const end = new Date();
              const start = new Date(
                end.getTime() - 48 * 60 * 60 * 1000
              );

              const response = await fetch(
                getMarketUrl(start, end),
                { signal: controller.signal }
              );

              if (!response.ok) {
                throw new Error(
                  "Failed to load price: " + response.status
                );
              }

              const result = await response.json();

              if (controller.signal.aborted) return;

              const recent = normalizeCandles(result.candles || []);

              if (!recent.length) {
                priceElement.textContent = "Price unavailable";
                return;
              }

              const latest = recent[recent.length - 1];

              priceElement.textContent = formatPrice(latest.close);

              priceTimeElement.textContent =
                "Latest stored price: " +
                new Date(latest.timestamp).toLocaleString();

              const target =
                latest.timestamp - 24 * 60 * 60 * 1000;

              const comparison = recent.reduce((best, candle) => {
                const distance = Math.abs(
                  candle.timestamp - target
                );

                if (!best || distance < best.distance) {
                  return { candle, distance };
                }

                return best;
              }, null);

              if (
                !comparison ||
                comparison.distance > 2 * 60 * 60 * 1000 ||
                comparison.candle.close <= 0
              ) {
                changeElement.textContent =
                  "24h change: unavailable";
                return;
              }

              const delta =
                latest.close - comparison.candle.close;

              const percentage =
                delta / comparison.candle.close * 100;

              const direction =
                delta > 0 ? 1 : delta < 0 ? -1 : 0;

              const sign =
                direction > 0 ? "+" :
                direction < 0 ? "−" : "";

              const color =
                direction > 0 ? "positive" :
                direction < 0 ? "negative" : "neutral";

              const absoluteChange = formatPrice(
                Math.abs(delta)
              );

              priceElement.className =
                "current-price " + color;

              changeElement.className =
                "price-change " + color;

              changeElement.textContent =
                sign + absoluteChange +
                " (" + sign +
                Math.abs(percentage).toFixed(2) +
                "%) past 24h";

            } catch (error) {
              if (controller.signal.aborted) return;

              console.error(
                "[market-data.chart] Failed to load price summary:",
                error
              );

              priceElement.textContent = "Price unavailable";
              changeElement.textContent =
                "24h change: unavailable";

            } finally {
              if (priceController === controller) {
                priceController = null;
              }
            }
          }

          /**
           * Synchronize selected currency with browser URL.
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
           * Currency button handling.
           */
          currencyButtons.forEach(button => {
            button.addEventListener("click", () => {
              const selectedCurrency = button.dataset.currency;

              if (
                selectedCurrency === currentCurrency ||
                (isMetal && selectedCurrency !== "USD")
              ) return;

              currentCurrency = selectedCurrency;

              updateActiveCurrency();
              updateChartTitle();
              updateCurrencyUrl();
              loadChart(currentRange);
              loadPriceSummary();
            });
          });

          /**
           * Date range button handling.
           */
          rangeButtons.forEach(button => {
            button.addEventListener("click", () => {
              loadChart(button.dataset.range);
            });
          });

          /**
           * Initial chart load.
           */
          updateActiveCurrency();
          updateChartTitle();
          loadChart(currentRange);
          loadPriceSummary();
        </script>
      </body>
    </html>
  `);
});

export default router;
