# services/ocr/Dockerfile — ConsorcIA OCR (PRD-02-03 §5.4)
#
# Variante CPU-friendly para desarrollo en macOS (sin GPU NVIDIA).
# El servicio levanta con /health funcional; el modelo baidu/Unlimited-OCR
# requiere GPU y se carga solo en hosts con CUDA (ver notas abajo).
#
# Para producción / host con GPU NVIDIA, usar como imagen base:
#   FROM nvidia/cuda:12.9.0-runtime-ubuntu22.04
# e instalar Python 3.12 + torch con CUDA + transformers, y descomentar
# la reserva de GPU en docker-compose.yml (servicio ocr-service).

FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y \
    curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD curl -f http://localhost:8000/health || exit 1

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
