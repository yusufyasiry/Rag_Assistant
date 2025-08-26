# syntax=docker/dockerfile:1
FROM python:3.11-slim

# Prevent .pyc and force unbuffered logs
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# System deps (build-essential needed by some pip packages)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential curl wget ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Install deps
COPY requirements.txt /app/requirements.txt
RUN pip install --upgrade pip && pip install --no-cache-dir -r requirements.txt

# Copy code
COPY . /app

# Render will inject $PORT
ENV PORT=8000

# Healthcheck
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/health" || exit 1

# Run API
CMD ["sh", "-c", "uvicorn api:app --host 0.0.0.0 --port ${PORT}"]
