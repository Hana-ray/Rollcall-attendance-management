FROM node:22-bookworm-slim AS web
WORKDIR /build
COPY package*.json ./
RUN npm ci
COPY index.html vite.config.js src.jsx style.css ./
RUN npm run build

FROM python:3.13-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py .
COPY --from=web /build/dist ./dist
ENV PYTHONUNBUFFERED=1
CMD ["sh","-c","exec uvicorn app:app --host 0.0.0.0 --port ${PORT:-8000}"]
