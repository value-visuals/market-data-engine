import express from "express";
import marketDataRoutes from "./routes/market-data.routes.js";
import chartRoutes from "./routes/chart.routes.js";

const PORT = process.env.PORT || 5025;

const app = express();

app.use(express.json());

app.use(
  "/api/market-data",
  marketDataRoutes
);

app.use(
  "/chart",
  chartRoutes
);

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "market-data-engine",
    timestamp: new Date().toISOString(),
  });
});

app.listen(PORT, () => {
  console.log(`Server: http://localhost:${PORT}`);
  console.log(`API:    http://localhost:${PORT}/api/market-data`);
  console.log(`Chart:  http://localhost:${PORT}/chart/BTC`);
});

export default app;