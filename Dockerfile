FROM python:3.12-slim AS backend

WORKDIR /app

# Install system deps needed by sentence-transformers / chromadb
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ ./

# --- Frontend build stage ---
FROM node:20-slim AS frontend
WORKDIR /ui
COPY frontend/package*.json ./
RUN npm ci --silent
COPY frontend/ ./
RUN npm run build

# --- Final image ---
FROM backend AS final
COPY --from=frontend /ui/dist /app/static

EXPOSE 8000

ENV PYTHONUNBUFFERED=1

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
