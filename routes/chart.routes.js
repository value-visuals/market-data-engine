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

        <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>

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

        <div id="status" class="status"></div>

        <div class="chart-container">
          <canvas id="chart"></canvas>
        </div>

        <script>
          let chart = null;
          let candles = [];

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

          async function loadChart(range) {
            const status = document.getElementById("status");

            status.textContent = "Loading...";

            const dates = getStartDate(range);

            const params = new URLSearchParams({
              start: dates.start,
              end: dates.end
            });

            const response = await fetch(
              "/api/market-data/${symbol}?" + params.toString()
            );

            if (!response.ok) {
              throw new Error(
                "Failed to load market data: " + response.status
              );
            }

            const result = await response.json();

            candles = result.candles || [];

            const labels = candles.map(candle =>
              new Date(candle.timestamp).toLocaleString()
            );

            const prices = candles.map(candle =>
              candle.close
            );

            if (chart) {
              chart.destroy();
            }

            chart = new Chart(
              document.getElementById("chart"),
              {
                type: "line",

                data: {
                  labels,

                  datasets: [
                    {
                      label: "${symbol} Close",
                      data: prices,

                      borderColor: "#22c55e",
                      backgroundColor:
                        "rgba(34, 197, 94, 0.1)",

                      borderWidth: 2,

                      pointRadius: 0,
                      pointHoverRadius: 5,

                      tension: 0.1,

                      fill: true
                    }
                  ]
                },

                options: {
                  responsive: true,
                  maintainAspectRatio: false,

                  interaction: {
                    mode: "index",
                    intersect: false
                  },

                  plugins: {
                    tooltip: {
                      enabled: true,

                      callbacks: {
                        title: function(context) {
                          const index =
                            context[0].dataIndex;

                          const candle =
                            candles[index];

                          return new Date(
                            candle.timestamp
                          ).toLocaleString();
                        },

                        label: function(context) {
                          const index =
                            context.dataIndex;

                          const candle =
                            candles[index];

                          return [
                            "Open: " +
                              (candle.open ?? "N/A"),

                            "High: " +
                              (candle.high ?? "N/A"),

                            "Low: " +
                              (candle.low ?? "N/A"),

                            "Close: " +
                              (candle.close ?? "N/A"),

                            "Volume: " +
                              (candle.volume ?? "N/A")
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
                      ticks: {
                        color: "#9ca3af"
                      },

                      grid: {
                        color:
                          "rgba(156, 163, 175, 0.1)"
                      }
                    },

                    y: {
                      ticks: {
                        color: "#9ca3af"
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

            status.textContent =
              candles.length +
              " candles | " +
              dates.start +
              " → " +
              dates.end;
          }

          document
            .querySelectorAll("[data-range]")
            .forEach(button => {

              button.addEventListener(
                "click",
                () => {

                  document
                    .querySelectorAll("[data-range]")
                    .forEach(btn =>
                      btn.classList.remove("active")
                    );

                  button.classList.add("active");

                  loadChart(button.dataset.range)
                    .catch(error => {

                      console.error(error);

                      document.getElementById(
                        "status"
                      ).textContent =
                        "Failed to load market data.";
                    });
                }
              );
            });

          // Default range
          document
            .querySelector('[data-range="1D"]')
            .click();
        </script>

      </body>
    </html>
  `);
});

export default router;