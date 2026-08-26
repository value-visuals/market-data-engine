import express from "express";

const router = express.Router();

router.get("/:symbol", (req, res) => {
  const symbol = String(req.params.symbol)
    .trim()
    .toUpperCase();

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

          button:hover {
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
        </div>

        <div id="status" class="status">
          Loading...
        </div>

        <div class="chart-container">
          <canvas id="chart"></canvas>
        </div>

        <script>
          let chart = null;
          let candles = [];

          /**
           * Calculate the requested date range.
           */
          function getStartDate(range) {
            const end = new Date();
            const start = new Date(end);

            switch (range) {
              case "1D":
                start.setDate(
                  start.getDate() - 1
                );
                break;

              case "2D":
                start.setDate(
                  start.getDate() - 2
                );
                break;

              case "3D":
                start.setDate(
                  start.getDate() - 3
                );
                break;

              case "7D":
                start.setDate(
                  start.getDate() - 7
                );
                break;

              case "14D":
                start.setDate(
                  start.getDate() - 14
                );
                break;

              case "1M":
                start.setMonth(
                  start.getMonth() - 1
                );
                break;

              case "2M":
                start.setMonth(
                  start.getMonth() - 2
                );
                break;

              case "3M":
                start.setMonth(
                  start.getMonth() - 3
                );
                break;

              case "6M":
                start.setMonth(
                  start.getMonth() - 6
                );
                break;

              case "1Y":
                start.setFullYear(
                  start.getFullYear() - 1
                );
                break;

              default:
                throw new Error(
                  "Unsupported range: " + range
                );
            }

            return {
              start: start.toISOString(),
              end: end.toISOString()
            };
          }

          /**
           * Convert a Firebase timestamp into
           * a JavaScript millisecond timestamp.
           *
           * Supports:
           *
           *   number
           *   string
           *   Firestore Timestamp-like objects
           *   { _seconds, _nanoseconds }
           *   { seconds, nanoseconds }
           */
          function normalizeTimestamp(value) {
            if (
              value === null ||
              value === undefined
            ) {
              return null;
            }

            if (
              typeof value === "number" &&
              Number.isFinite(value)
            ) {
              /*
               * Your ingestion code currently stores
               * CoinGecko timestamps in milliseconds.
               *
               * If a value looks like seconds,
               * convert it to milliseconds.
               */
              if (value < 10_000_000_000) {
                return value * 1000;
              }

              return value;
            }

            if (typeof value === "string") {
              const numeric = Number(value);

              if (Number.isFinite(numeric)) {
                if (
                  numeric <
                  10_000_000_000
                ) {
                  return numeric * 1000;
                }

                return numeric;
              }

              const parsed =
                Date.parse(value);

              if (
                Number.isFinite(parsed)
              ) {
                return parsed;
              }

              return null;
            }

            /*
             * Firestore Timestamp format.
             */
            if (
              typeof value === "object"
            ) {
              if (
                Number.isFinite(
                  value.seconds
                )
              ) {
                return (
                  Number(value.seconds) *
                    1000 +
                  Math.floor(
                    Number(
                      value.nanoseconds || 0
                    ) / 1_000_000
                  )
                );
              }

              /*
               * Some Firebase serializers expose
               * _seconds / _nanoseconds.
               */
              if (
                Number.isFinite(
                  value._seconds
                )
              ) {
                return (
                  Number(value._seconds) *
                    1000 +
                  Math.floor(
                    Number(
                      value._nanoseconds || 0
                    ) / 1_000_000
                  )
                );
              }

              /*
               * Firestore Timestamp objects may
               * provide toMillis().
               */
              if (
                typeof value.toMillis ===
                "function"
              ) {
                const milliseconds =
                  value.toMillis();

                if (
                  Number.isFinite(
                    milliseconds
                  )
                ) {
                  return milliseconds;
                }
              }

              /*
               * Firestore Timestamp-like
               * toDate().
               */
              if (
                typeof value.toDate ===
                "function"
              ) {
                const date =
                  value.toDate();

                const milliseconds =
                  date.getTime();

                if (
                  Number.isFinite(
                    milliseconds
                  )
                ) {
                  return milliseconds;
                }
              }
            }

            return null;
          }

          /**
           * Normalize and sort the data returned
           * from Firebase.
           */
          function normalizeCandles(input) {
            if (
              !Array.isArray(input)
            ) {
              return [];
            }

            const unique =
              new Map();

            for (
              const candle of input
            ) {
              if (
                !candle ||
                typeof candle !==
                  "object"
              ) {
                continue;
              }

              const timestamp =
                normalizeTimestamp(
                  candle.timestamp
                );

              const close =
                Number(
                  candle.close
                );

              if (
                timestamp === null ||
                !Number.isFinite(close)
              ) {
                continue;
              }

              /*
               * Use timestamp as the key.
               *
               * This protects the chart from
               * duplicate Firebase records.
               */
              unique.set(
                timestamp,
                {
                  ...candle,
                  timestamp,
                  close
                }
              );
            }

            return Array.from(
              unique.values()
            ).sort(
              (a, b) =>
                a.timestamp -
                b.timestamp
            );
          }

          /**
           * Create the Chart.js time-series data.
           *
           * IMPORTANT:
           *
           * We do NOT create a labels array.
           *
           * Instead we give Chart.js real x/y
           * coordinates.
           *
           * This allows Chart.js to understand that
           *
           * 10:00 → 10:15
           *
           * is different from
           *
           * 10:15 → 12:00.
           */
          function createChartData() {
            return candles.map(
              candle => ({
                x: candle.timestamp,
                y: candle.close
              })
            );
          }

          /**
           * Create the chart.
           */
          function renderChart() {
            const canvas =
              document.getElementById(
                "chart"
              );

            if (chart) {
              chart.destroy();
              chart = null;
            }

            const data =
              createChartData();

            chart = new Chart(
              canvas,
              {
                type: "line",

                data: {
                  datasets: [
                    {
                      label:
                        "${symbol} Close",

                      data,

                      borderColor:
                        "#22c55e",

                      backgroundColor:
                        "rgba(34, 197, 94, 0.10)",

                      borderWidth: 2,

                      /*
                       * Do not draw every point.
                       *
                       * The actual timestamp is still
                       * preserved.
                       */
                      pointRadius: 0,

                      pointHoverRadius: 5,

                      /*
                       * Disable smoothing while
                       * validating market data.
                       */
                      tension: 0,

                      fill: true,

                      /*
                       * Tell Chart.js that x contains
                       * time values.
                       */
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
                        title:
                          function(
                            context
                          ) {
                            if (
                              !context
                                .length
                            ) {
                              return "";
                            }

                            const index =
                              context[0]
                                .dataIndex;

                            const candle =
                              candles[
                                index
                              ];

                            if (
                              !candle
                            ) {
                              return "";
                            }

                            return new Date(
                              candle.timestamp
                            ).toLocaleString();
                          },

                        label:
                          function(
                            context
                          ) {
                            const index =
                              context
                                .dataIndex;

                            const candle =
                              candles[
                                index
                              ];

                            if (
                              !candle
                            ) {
                              return "";
                            }

                            return [
                              "Open: " +
                                (
                                  candle.open ??
                                  "N/A"
                                ),

                              "High: " +
                                (
                                  candle.high ??
                                  "N/A"
                                ),

                              "Low: " +
                                (
                                  candle.low ??
                                  "N/A"
                                ),

                              "Close: " +
                                (
                                  candle.close ??
                                  "N/A"
                                ),

                              "Volume: " +
                                (
                                  candle.volume ??
                                  "N/A"
                                )
                            ];
                          }
                      }
                    },

                    legend: {
                      labels: {
                        color:
                          "#ffffff"
                      }
                    }
                  },

                  scales: {
                    x: {
                      type: "time",

                      /*
                       * Chart.js + Luxon will
                       * automatically choose an
                       * appropriate display format
                       * based on the selected range.
                       */
                      time: {
                        tooltipFormat:
                          "MMM d, yyyy HH:mm"
                      },

                      ticks: {
                        color:
                          "#9ca3af",

                        maxRotation: 0,

                        autoSkip: true
                      },

                      grid: {
                        color:
                          "rgba(156, 163, 175, 0.1)"
                      }
                    },

                    y: {
                      ticks: {
                        color:
                          "#9ca3af",

                        callback:
                          function(
                            value
                          ) {
                            return Number(
                              value
                            ).toLocaleString(
                              undefined,
                              {
                                maximumFractionDigits:
                                  2
                              }
                            );
                          }
                      },

                      grid: {
                        color:
                          "rgba(156, 163, 175, 0.1)"
                      }
                    }
                  }
                }
              }
            );
          }

          /**
           * Load market data from Firebase API.
           */
          async function loadChart(
            range
          ) {
            const status =
              document.getElementById(
                "status"
              );

            status.classList.remove(
              "error"
            );

            status.textContent =
              "Loading...";

            try {
              const dates =
                getStartDate(
                  range
                );

              const params =
                new URLSearchParams({
                  start: dates.start,
                  end: dates.end
                });

              const response =
                await fetch(
                  "/api/market-data/${symbol}?" +
                    params.toString()
                );

              if (
                !response.ok
              ) {
                throw new Error(
                  "Failed to load market data: " +
                    response.status
                );
              }

              const result =
                await response.json();

              /*
               * Normalize timestamps,
               * remove duplicate timestamps,
               * and sort chronologically.
               */
              candles =
                normalizeCandles(
                  result.candles ||
                    []
                );

              if (
                candles.length === 0
              ) {
                if (chart) {
                  chart.destroy();
                  chart = null;
                }

                status.textContent =
                  "No market data found for " +
                  range +
                  ".";

                return;
              }

              /*
               * Render using real timestamps.
               */
              renderChart();

              const first =
                candles[0];

              const last =
                candles[
                  candles.length - 1
                ];

              const firstDate =
                new Date(
                  first.timestamp
                ).toLocaleString();

              const lastDate =
                new Date(
                  last.timestamp
                ).toLocaleString();

              status.textContent =
                candles.length +
                " data points | " +
                firstDate +
                " → " +
                lastDate;
            } catch (error) {
              console.error(
                error
              );

              status.classList.add(
                "error"
              );

              status.textContent =
                "Failed to load market data.";
            }
          }

          /**
           * Range button handling.
           */
          document
            .querySelectorAll(
              "[data-range]"
            )
            .forEach(
              button => {
                button.addEventListener(
                  "click",
                  () => {
                    document
                      .querySelectorAll(
                        "[data-range]"
                      )
                      .forEach(
                        btn =>
                          btn.classList.remove(
                            "active"
                          )
                      );

                    button.classList.add(
                      "active"
                    );

                    loadChart(
                      button.dataset
                        .range
                    );
                  }
                );
              }
            );

          /*
           * Default range.
           */
          document
            .querySelector(
              '[data-range="1D"]'
            )
            .click();
        </script>

      </body>
    </html>
  `);
});

export default router;