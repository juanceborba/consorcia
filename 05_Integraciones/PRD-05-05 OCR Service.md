---
title: "PRD-05-05: OCR Service"
description: "Especificacion del microservicio de OCR basado en baidu/Unlimited-OCR: extraccion de texto, tablas y estructura de documentos, con API REST para consumo desde el backend NodeJS."
author: "ConsorcIA Team"
date: 2026-07-26
status: "vigente"
priority: "P1"
tags: [ocr, baidu, unlimited-ocr, microservicio, python, fastapi, pdf, parsing, consorcIA]
outcomes:
  - "Definir arquitectura del microservicio OCR (Python + FastAPI)"
  - "Especificar endpoints de extraccion de texto y tablas"
  - "Disenar formato de respuesta estructurada (JSON)"
  - "Establecer requisitos de hardware (GPU) y deployment"
  - "Documentar integracion con backend NodeJS"
---

# PRD-05-05: OCR Service

> **El OCR Service es un microservicio independiente en Python que ejecuta baidu/Unlimited-OCR para extraer texto estructurado de PDFs e imagenes de documentos de consorcios. Se comunica con el backend NodeJS via HTTP/gRPC y corre en GPU para inferencia rapida.**

---

## 1. Arquitectura

### 1.1 Por que microservicio separado

| Aspecto | Backend NodeJS | OCR Service Python |
|---------|---------------|-------------------|
| Lenguaje | NodeJS | Python 3.12 |
| Framework | Express | FastAPI |
| OCR Engine | No disponible | baidu/Unlimited-OCR |
| Dependencias | NPM | PyTorch 2.10, CUDA 12.9, transformers 4.57 |
| Hardware | CPU | GPU (CUDA) |
| Escalabilidad | Horizontal (ECS) | Vertical (GPU) o serverless GPU |

> **El OCR requiere un stack Python + CUDA que no mezclamos con NodeJS. Es un microservicio con API limpia.**

### 1.2 Diagrama de arquitectura

```
+-------------------------------------------------------------+
|                    BACKEND NODEJS + EXPRESS                  |
|  - API REST                                                  |
|  - Motor contable                                            |
|  - Agentes Swarm                                             |
|  - Recibe PDF de usuario                                     |
|  - Envia a OCR Service                                       |
+----------------------+--------------------------------------+
                       | HTTP/gRPC
                       v
+-------------------------------------------------------------+
|                    OCR SERVICE (Python + FastAPI)            |
|  - Recibe URL del PDF                                        |
|  - Descarga desde MinIO/S3                                   |
|  - Ejecuta Unlimited-OCR                                     |
|  - Extrae: texto, tablas, layout, coordenadas                |
|  - Retorna JSON estructurado                                 |
+----------------------+--------------------------------------+
                       |
                       v
+-------------------------------------------------------------+
|                    GPU (NVIDIA CUDA)                         |
|  - baidu/Unlimited-OCR inference                             |
|  - SGLang para batch concurrente                             |
+-------------------------------------------------------------+
```

---

## 2. Endpoints

### 2.1 API REST

```
POST /ocr/extract
  Request:
  {
    "pdfUrl": "https://minio.consorcia.com/bucket/edificio-123/liquidacion_julio.pdf",
    "edificioId": "edificio-123",
    "tipoDocumento": "expensas",
    "options": {
      "extraerTablas": true,
      "extraerLayout": true,
      "idioma": "es"
    }
  }

  Response:
  {
    "success": true,
    "processingTimeMs": 3450,
    "paginas": [
      {
        "numero": 1,
        "texto": "LIQUIDACION DE EXPENSAS...",
        "tablas": [
          {
            "filas": [
              ["Concepto", "Monto"],
              ["Luz Edesur", "$245.678,90"],
              ["Agua AySA", "$89.450,00"],
              ["ABL", "$156.000,00"]
            ]
          }
        ],
        "bloques": [
          {
            "tipo": "tabla",
            "texto": "...",
            "coordenadas": {"x": 50, "y": 200, "w": 500, "h": 300}
          }
        ]
      }
    ],
    "conceptosDetectados": [
      {
        "concepto": "Luz Edesur",
        "monto": 245678.90,
        "pagina": 1,
        "coordenadas": {"x": 100, "y": 250, "w": 200, "h": 20},
        "confianza": 0.97
      }
    ],
    "metadata": {
      "totalPaginas": 3,
      "confianzaPromedio": 0.94,
      "tipoDetectado": "liquidacion_expensas"
    }
  }
```

```
POST /ocr/batch
  // Procesa multiples PDFs en paralelo
  // Util para onboarding masivo de carteras

GET /health
  // Health check para Docker/orquestador

GET /metrics
  // Metricas de Prometheus: requests, latency, GPU utilization
```

### 2.2 gRPC (alternativa para alto volumen)

```protobuf
service OcrService {
  rpc Extract(OcrRequest) returns (OcrResponse);
  rpc ExtractBatch(stream OcrRequest) returns (stream OcrResponse);
  rpc Health(Empty) returns (HealthResponse);
}
```

---

## 3. Modelo Unlimited-OCR

### 3.1 Caracteristicas

| Caracteristica | Valor |
|----------------|-------|
| **Modelo** | baidu/Unlimited-OCR (HuggingFace) |
| **Tipo** | Vision-Language Model (VLM) |
| **Capacidad** | One-shot long-horizon parsing |
| **Entrada** | PDFs e imagenes (PNG, JPG, TIFF) |
| **Salida** | Texto estructurado, tablas, layout |
| **Idiomas** | Multilingue (espanol soportado) |
| **Framework** | PyTorch 2.10 + transformers 4.57 |
| **Runtime** | SGLang (para batch inference concurrente) |
| **GPU minima** | NVIDIA RTX 4090 (24GB VRAM) |
| **GPU recomendada** | NVIDIA A100 (40GB VRAM) |

### 3.2 Prompt de extraccion

```python
EXTRACTION_PROMPT = """
Analiza este documento de un consorcio de propiedad horizontal argentino.
Extrae:
1. Todos los conceptos de gastos con sus montos
2. Tablas de distribucion por unidad funcional (si existen)
3. Fechas de periodo
4. Totales (ordinarias, extraordinarias, general)

Formato de salida en JSON con los campos: conceptos, tablas, totales, periodo
"""
```

---

## 4. Requisitos de Hardware

### 4.1 Desarrollo local

| Componente | Minimo | Recomendado |
|------------|--------|-------------|
| GPU | NVIDIA RTX 3060 (12GB) | NVIDIA RTX 4090 (24GB) |
| RAM | 16GB | 32GB |
| CPU | 6 cores | 8+ cores |
| Disco | 50GB SSD | 100GB NVMe |
| CUDA | 12.0+ | 12.9 |

### 4.2 Produccion (cloud GPU)

| Opcion | Costo/hora | Cuando usar |
|--------|-----------|-------------|
| **AWS g4dn.xlarge** (T4) | ~$0.50 | Desarrollo, bajo volumen |
| **AWS g5.xlarge** (A10G) | ~$1.00 | Produccion inicial |
| **AWS p3.2xlarge** (V100) | ~$3.00 | Alto volumen |
| **AWS p4d.24xlarge** (A100) | ~$30.00 | Escala masiva |
| **RunPod / Vast.ai** | $0.20-0.80 | Alternativa economica |

### 4.3 Estrategia de deployment

```
Desarrollo (Mes 1-4):
  -> GPU local (RTX 4090 del dev)
  -> Costo: $0

Staging (Mes 3-4):
  -> RunPod / Vast.ai on-demand
  -> Costo: ~$50-100/mes

Produccion inicial (Mes 4+):
  -> AWS g5.xlarge (spot cuando sea posible)
  -> Costo: ~$200-400/mes

Escala (500+ edificios):
  -> AWS g5.2xlarge o p3.2xlarge
  -> Auto-scaling por cola de requests
  -> Costo: ~$500-1.000/mes
```

---

## 5. Integracion con Backend NodeJS

### 5.1 Cliente HTTP

```typescript
// services/ocr.client.ts
import axios from "axios";

const ocrClient = axios.create({
  baseURL: process.env.OCR_SERVICE_URL,
  timeout: 60000, // 60s para PDFs grandes
});

export async function extractFromPdf(
  pdfUrl: string,
  edificioId: string,
  tipoDocumento: string
): Promise<OcrResponse> {
  const response = await ocrClient.post("/ocr/extract", {
    pdfUrl,
    edificioId,
    tipoDocumento,
    options: {
      extraerTablas: true,
      extraerLayout: true,
      idioma: "es",
    },
  });
  return response.data;
}
```

### 5.2 Manejo de errores

| Error | Estrategia | Fallback |
|-------|-----------|----------|
| OCR Service no responde | Retry 3x con backoff | Marcar como "requiere carga manual" |
| GPU out of memory | Retry con batch mas chico | Procesar pagina por pagina |
| Confianza <70% | Flaggear para revision humana | Admin revisa en preview |
| PDF corrupto | Notificar admin | Solicitar re-upload |
| Timeout | Retry con timeout mayor | Procesar async (cola) |

### 5.3 Cola de procesamiento async

```
Para PDFs grandes o alto volumen:
  1. Backend encola job en Redis
  2. Worker consume job y llama a OCR Service
  3. OCR Service procesa y guarda resultado en DB
  4. Backend notifica admin cuando esta listo
  5. Admin revisa preview y confirma
```

---

## 6. Decisiones de Diseno Clave

| Decision | Eleccion | Justificacion |
|----------|----------|---------------|
| **Modelo OCR** | baidu/Unlimited-OCR | One-shot parsing de documentos largos. Mejor que Tesseract para layouts complejos. |
| **Microservicio** | Python + FastAPI separado | Requiere PyTorch + CUDA. No mezclar con NodeJS. |
| **Protocolo** | HTTP REST (gRPC opcional) | Mas simple para integrar. gRPC para alto volumen futuro. |
| **GPU local en dev** | Si | $0 en tokens de OCR. Sin rate limits. |
| **Cloud GPU en prod** | AWS g5 / RunPod | Escalable. Spot instances para ahorrar. |
| **Batch async** | Para PDFs grandes | Evita timeouts. Mejor UX para el admin. |
| **Confianza minima** | 70% | Debajo de esto, flag para revision humana. Balance automatizacion/precision. |

---

*Documento relacionado:* [[PRD-04-07 Importacion Inteligente]]
*Documento relacionado:* [[PRD-03-04 Agente Documental]]
*Documento relacionado:* [[PRD-02-03 Infraestructura Docker]]
*Documento relacionado:* [[PRD-08-03 Deploy AWS]]
*Documento relacionado:* [[PRD-08-04 Monitoring]]