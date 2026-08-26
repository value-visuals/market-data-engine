# Dockerfile

FROM node:22-alpine

# Production environment
ENV NODE_ENV=production

WORKDIR /app

# Install dependencies first for better Docker layer caching
COPY package*.json ./

RUN npm ci --omit=dev && npm cache clean --force

# Copy only files needed by the ingestion worker
COPY config ./config
COPY jobs ./jobs
COPY normalizers ./normalizers
COPY providers ./providers
COPY repositories ./repositories
COPY pull-market-data.js ./

# Run the market data ingestion worker
CMD ["npm", "run", "pull"]
