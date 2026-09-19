# Market Data Engine

Market Data Engine is a Node.js service for collecting cryptocurrency and precious-metals market data and storing it in Firebase Firestore.

The project has two separate components:

1. **Market data ingestion** — pulls market data from external providers, normalizes it, and stores it in Firebase.
2. **Express API and chart viewer** — provides a simple way to inspect and query data that has already been collected in Firebase.

> **Important:** The included `Dockerfile` is only for running the market data ingestion worker with `npm run pull`. It does **not** install, configure, or run the Express API.

---

## Supported Market Data

### Cryptocurrency

Current cryptocurrency assets:

* Bitcoin (`BTC`)
* Ethereum (`ETH`)
* Monero (`XMR`)

Quote currencies:

* USD
* EUR
* GBP

Cryptocurrency data is retrieved from **CoinGecko**.

### Precious Metals

Current precious-metal assets:

* Gold (`XAU`)
* Silver (`XAG`)

Metal data is currently stored in USD and retrieved from **API Ninjas**.

---

## How It Works

```text
CoinGecko ──────┐
                │
API Ninjas ─────┼──> pull-market-data.js
                │          │
                │          ▼
                │     Normalization
                │          │
                │          ▼
                └────> Firebase Firestore
                           │
                           ▼
                       Express API
                           │
                    ┌──────┴──────┐
                    ▼             ▼
                  JSON API     Chart Viewer
```

The ingestion worker and Express server are intentionally separate.

The ingestion worker does not require the Express server to be running.

Likewise, the Express server does not pull new market data. It reads data that has already been written to Firebase.

---

## Requirements

* Node.js 22 recommended
* npm
* Firebase / Firestore project
* Firebase service account credentials
* API Ninjas API key for precious-metal data
* CoinGecko API key optional

---

## Installation

Clone the repository:

```bash
git clone https://github.com/value-visuals/market-data-engine.git
cd market-data-engine
```

Install dependencies:

```bash
npm install
```

---

## Environment Variables

Create a `.env` file in the project root.

```env
FIREBASE_PROJECT_ID=your-firebase-project-id
FIREBASE_CLIENT_EMAIL=your-service-account-email
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"

COINGECKO_API_KEY=your-coingecko-api-key
API_NINJA_API_KEY=your-api-ninjas-key

PORT=3000
```


# Market Data Ingestion

The primary purpose of this project is collecting market data and storing it in Firestore.

Start the ingestion worker with:

```bash
npm run pull
```

This executes:

```bash
node pull-market-data.js
```

On startup, the worker:

1. Checks for historical market data.
2. Backfills missing history when necessary.
3. Pulls the latest cryptocurrency data.
4. Pulls the latest precious-metal data.
5. Writes new data to Firebase Firestore.
6. Continues running and performs another ingestion cycle every 30 minutes.

Existing historical data is checked before backfills are performed so the worker does not blindly download the complete history every time it starts.

---

## Firestore Structure

Market data is stored under the `marketData` collection.

Cryptocurrency series are separated by asset and quote currency:

```text
marketData/
  BTC/
    candles/
      USD/
        data/
      EUR/
        data/
      GBP/
        data/

  ETH/
    candles/
      USD/
        data/
      EUR/
        data/
      GBP/
        data/

  XMR/
    candles/
      USD/
        data/
      EUR/
        data/
      GBP/
        data/
```

Precious metals currently use USD:

```text
marketData/
  XAU/
    candles/
      USD/
        data/

  XAG/
    candles/
      USD/
        data/
```

---

# Docker

The included Dockerfile is specifically designed for the **market data ingestion worker**.

Build the image:

```bash
docker build -t market-data-engine .
```

Run it:

```bash
docker run --env-file .env market-data-engine
```

The container starts:

```bash
npm run pull
```

which runs:

```bash
node pull-market-data.js
```

## Docker Does Not Run the Express API

The Dockerfile intentionally copies only the files required by the ingestion worker:

```text
config/
jobs/
normalizers/
providers/
repositories/
pull-market-data.js
```

It does not copy or configure the Express API files such as:

```text
index.js
routes/
```

Therefore, building this Docker image does **not** create an HTTP API service and does not expose an Express server.

If you want to run the Express API, run it separately as described below.

---

# Express API

The Express application is an optional interface for viewing and querying market data that has already been collected in Firebase.

It is not responsible for scheduled market-data ingestion.

Start the API with:

```bash
npm start
```

This executes:

```bash
NODE_ENV=production node index.js
```

The default port is:

```text
3000
```

You can override it with:

```env
PORT=3000
```

For development:

```bash
npm run dev
```

---

## API Endpoints

### Health Check

```http
GET /health
```

Example:

```text
http://localhost:3000/health
```

---

### Market Data

Retrieve stored market data for a symbol and date range:

```http
GET /api/market-data/:symbol?start=<start>&end=<end>
```

Example:

```text
http://localhost:3000/api/market-data/BTC?start=2026-08-01&end=2026-08-21
```

The response includes the symbol, requested range, number of returned records, and stored candle data.

---

### Latest Market Data

Retrieve the latest stored market-data record:

```http
GET /api/market-data/:symbol/latest
```

Example:

```text
http://localhost:3000/api/market-data/BTC/latest
```

---

# Chart Viewer

The Express application also includes a simple browser-based chart viewer for inspecting stored data.

Example:

```text
http://localhost:3000/chart/BTC
```

The chart interface provides several date ranges for viewing the available market data.

The chart viewer is intended primarily as a convenient way to inspect the data stored by the ingestion engine.

---

# npm Commands

```bash
npm run pull
```

Run the market-data ingestion worker.

```bash
npm start
```

Start the Express API and chart viewer.

```bash
npm run dev
```

Start the Express API with Nodemon for local development.

```bash
npm run lint
```

Run ESLint.

```bash
npm run knip
```

Check for unused files, dependencies, and exports.

```bash
npm run check
```

Run both ESLint and Knip.

---

# Project Structure

```text
market-data-engine/
├── config/
│   └── firebase.js
├── jobs/
│   ├── crypto.job.js
│   └── metals.job.js
├── normalizers/
├── providers/
├── repositories/
│   └── market-data.repository.js
├── routes/
│   ├── chart.routes.js
│   └── market-data.routes.js
├── Dockerfile
├── index.js
├── pull-market-data.js
├── package.json
└── README.md
```

### `pull-market-data.js`

Runs the ingestion scheduler and coordinates cryptocurrency and precious-metal ingestion.

### `jobs/`

Contains asset-specific ingestion and historical backfill logic.

### `providers/`

Contains integrations with external market-data providers.

### `normalizers/`

Transforms provider responses into the application's normalized market-data format.

### `repositories/`

Handles persistence and retrieval of market data in Firebase Firestore.

### `index.js`

Starts the optional Express API.

### `routes/`

Contains the JSON API and browser chart routes.

---

# Deployment Model

A typical deployment can treat ingestion and data access as separate services:

```text
┌─────────────────────────┐
│ Ingestion Worker        │
│                        │
│ Docker                  │
│ npm run pull            │
│                        │
│ CoinGecko / API Ninjas │
└────────────┬────────────┘
             │
             ▼
      ┌──────────────┐
      │   Firebase   │
      │  Firestore   │
      └──────┬───────┘
             │
             ▼
┌─────────────────────────┐
│ Express API             │
│                        │
│ npm start              │
│                        │
│ API + Chart Viewer     │
└─────────────────────────┘
```

This allows the ingestion worker to run independently from applications or services that consume the collected data.

---

## Security

Firebase service-account credentials and third-party API keys should be treated as secrets.

Do not commit `.env` files, private keys, API keys, or Firebase service-account credentials to source control.

For production deployments, provide secrets through the environment or your hosting provider's secret-management system.

---

## License

ISC

