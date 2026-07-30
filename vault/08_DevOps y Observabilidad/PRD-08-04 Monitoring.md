---
title: "PRD-08-04: Monitoring"
description: "Observabilidad de ConsorcIA: logs, metricas, trazas, alertas y dashboards con CloudWatch, OpenTelemetry y herramientas de monitoreo."
author: "ConsorcIA Team"
date: 2026-07-26
status: "vigente"
priority: "P1"
tags: [devops, monitoring, observability, cloudwatch, opentelemetry, logs, metrics, alerts, consorcIA]
outcomes:
  - "Implementar logging estructurado con Pino"
  - "Configurar metricas con OpenTelemetry + CloudWatch"
  - "Establecer distributed tracing entre servicios"
  - "Crear alertas criticas (SLOs)"
  - "Disenar dashboards de monitoreo"
---

# PRD-08-04: Monitoring

> **La observabilidad de ConsorcIA cubre logs, metricas, trazas y alertas.** Todo servicio emite datos estructurados que se centralizan en CloudWatch para analisis y alertas proactivas.

---

## 1. Pilares de Observabilidad

```
+-------------------------------------------------------------+
|  OBSERVABILIDAD EN CONSORCIA                                |
+-------------------------------------------------------------+
|  LOGS (Pino)                                                |
|  |-- Request/response de API                               |
|  |-- Errores y excepciones                                  |
|  |-- Eventos de negocio (liquidacion, pago, ticket)        |
|  |-- Audit logs (RBAC, acceso a datos)                     |
+-------------------------------------------------------------+
|  METRICS (OpenTelemetry + CloudWatch)                        |
|  |-- Latencia de endpoints                                  |
|  |-- Throughput (requests/min)                              |
|  |-- Error rate                                             |
|  |-- Uso de recursos (CPU, memoria)                       |
|  |-- Metricas de negocio (pagos, liquidaciones)            |
+-------------------------------------------------------------+
|  TRACES (OpenTelemetry + X-Ray)                            |
|  |-- Request end-to-end                                     |
|  |-- LLM calls (latencia, tokens)                         |
|  |-- DB queries                                             |
|  |-- Swarm agent runs                                      |
+-------------------------------------------------------------+
|  ALERTS (CloudWatch Alarms + SNS)                          |
|  |-- Error rate > 1%                                        |
|  |-- Latencia p95 > 2s                                     |
|  |-- CPU > 80%                                              |
|  |-- LLM cost > presupuesto diario                         |
+-------------------------------------------------------------+
```

---

## 2. Logging

### 2.1 Pino configuration

```typescript
// src/lib/logger.ts
import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: process.env.NODE_ENV === 'development' 
    ? { target: 'pino-pretty' }
    : undefined,
  base: {
    service: 'consorcia-api',
    version: process.env.APP_VERSION,
  },
  redact: {
    paths: ['password', 'token', 'apiKey', 'secret', '*.password', '*.token'],
    remove: true,
  },
});
```

### 2.2 Formatos de log

```json
// Request log
{
  "level": "info",
  "time": 1722000000000,
  "msg": "request completed",
  "req": {
    "id": "req-123",
    "method": "POST",
    "url": "/api/gastos",
    "userId": "user-456",
    "edificioId": "edif-789"
  },
  "res": {
    "statusCode": 201,
    "durationMs": 45
  }
}

// Error log
{
  "level": "error",
  "time": 1722000000000,
  "msg": "Failed to process liquidacion",
  "err": {
    "type": "ValidationError",
    "message": "Suma de coeficientes != 100%",
    "stack": "..."
  },
  "context": {
    "liquidacionId": "liq-123",
    "edificioId": "edif-789"
  }
}

// Business event
{
  "level": "info",
  "time": 1722000000000,
  "msg": "liquidacion_generada",
  "event": "LIQUIDACION_GENERADA",
  "data": {
    "liquidacionId": "liq-123",
    "periodo": "2026-07",
    "montoTotal": 1215000,
    "edificioId": "edif-789"
  }
}
```

---

## 3. Metricas

### 3.1 OpenTelemetry setup

```typescript
// src/lib/telemetry.ts
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';

const sdk = new NodeSDK({
  metricReader: new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter({
      url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
    }),
    exportIntervalMillis: 60000,
  }),
});

sdk.start();
```

### 3.2 Metricas custom

```typescript
import { metrics } from '@opentelemetry/api';

const meter = metrics.getMeter('consorcia');

// Counter
const liquidacionesGeneradas = meter.createCounter('liquidaciones_generadas', {
  description: 'Numero de liquidaciones generadas',
});

// Histogram
const llmLatency = meter.createHistogram('llm_latency_ms', {
  description: 'Latencia de llamadas a LLM',
  unit: 'ms',
});

// Gauge
const deudaTotal = meter.createObservableGauge('deuda_total', {
  description: 'Deuda total del consorcio',
});

// Uso
liquidacionesGeneradas.add(1, { edificioId: 'edif-789' });
llmLatency.record(850, { agent: 'contable', model: 'nemotron' });
```

---

## 4. Distributed Tracing

### 4.1 Tracing con OpenTelemetry

```typescript
import { trace } from '@opentelemetry/api';

const tracer = trace.getTracer('consorcia-api');

async function generarLiquidacion(data: LiquidacionInput) {
  return tracer.startActiveSpan('generarLiquidacion', async (span) => {
    try {
      span.setAttribute('edificioId', data.edificioId);
      span.setAttribute('periodo', data.periodo);

      // Sub-span: validacion
      await tracer.startActiveSpan('validarCoeficientes', async (subSpan) => {
        await validarCoeficientes(data.edificioId);
        subSpan.end();
      });

      // Sub-span: LLM call
      await tracer.startActiveSpan('llmDistribucion', async (subSpan) => {
        const start = Date.now();
        const result = await llmAgent.distribuirGastos(data);
        subSpan.setAttribute('latency', Date.now() - start);
        subSpan.setAttribute('tokens', result.tokens);
        subSpan.end();
      });

      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.recordException(error);
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw error;
    } finally {
      span.end();
    }
  });
}
```

---

## 5. Alertas

### 5.1 CloudWatch Alarms

```hcl
resource "aws_cloudwatch_metric_alarm" "high_error_rate" {
  alarm_name          = "consorcia-high-error-rate"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "5xxErrorRate"
  namespace           = "AWS/ApplicationELB"
  period              = 60
  statistic           = "Average"
  threshold           = 1
  alarm_description   = "Error rate > 1%"
  alarm_actions       = [aws_sns_topic.alerts.arn]
}

resource "aws_cloudwatch_metric_alarm" "high_latency" {
  alarm_name          = "consorcia-high-latency"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  metric_name         = "TargetResponseTime"
  namespace           = "AWS/ApplicationELB"
  period              = 60
  extended_statistic  = "p95"
  threshold           = 2000
  alarm_description   = "p95 latency > 2s"
  alarm_actions       = [aws_sns_topic.alerts.arn]
}

resource "aws_cloudwatch_metric_alarm" "llm_cost" {
  alarm_name          = "consorcia-llm-cost"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "llm_cost_usd"
  namespace           = "ConsorcIA/Custom"
  period              = 86400
  statistic           = "Sum"
  threshold           = 50
  alarm_description   = "LLM cost > $50/day"
  alarm_actions       = [aws_sns_topic.alerts.arn]
}
```

### 5.2 SLOs

| SLO | Target | Ventana |
|-----|--------|---------|
| **Availability** | 99.9% | 30 dias |
| **Latency p95** | < 2s | 7 dias |
| **Error rate** | < 0.1% | 7 dias |
| **LLM latency p95** | < 5s | 7 dias |

---

## 6. Dashboards

### 6.1 CloudWatch Dashboard

```hcl
resource "aws_cloudwatch_dashboard" "main" {
  dashboard_name = "ConsorcIA-Main"
  dashboard_body = jsonencode({
    widgets = [
      {
        type   = "metric"
        x      = 0
        y      = 0
        width  = 12
        height = 6
        properties = {
          title  = "API Requests"
          metrics = [
            ["AWS/ApplicationELB", "RequestCount", "LoadBalancer", "${aws_lb.main.arn_suffix}"]
          ]
          period = 60
          stat   = "Sum"
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 0
        width  = 12
        height = 6
        properties = {
          title  = "Error Rate"
          metrics = [
            ["AWS/ApplicationELB", "HTTPCode_Target_5XX_Count", "LoadBalancer", "${aws_lb.main.arn_suffix}"]
          ]
          period = 60
          stat   = "Sum"
        }
      },
      {
        type   = "metric"
        x      = 0
        y      = 6
        width  = 24
        height = 6
        properties = {
          title  = "LLM Latency"
          metrics = [
            ["ConsorcIA/Custom", "llm_latency_ms", "agent", "contable"],
            ["ConsorcIA/Custom", "llm_latency_ms", "agent", "comunicador"]
          ]
          period = 300
          stat   = "p95"
        }
      }
    ]
  })
}
```

---

## 7. Decisiones de Diseno

| Decision | Eleccion | Justificacion |
|----------|----------|---------------|
| **Pino** | Sobre Winston | Mas rapido, estructurado por defecto, redact automatico. |
| **OpenTelemetry** | Sobre StatsD | Estandar CNCF. Unificado logs/metrics/traces. |
| **CloudWatch** | Sobre Datadog/NewRelic | Integracion nativa AWS. Menor costo inicial. |
| **X-Ray** | Sobre Jaeger | Integrado en ECS. Sin infra adicional. |
| **SNS + Email** | Sobre PagerDuty | MVP: email es suficiente. Fase 2: PagerDuty. |

---

*Documento relacionado:* [[PRD-02-03 Infraestructura Docker]]  
*Documento relacionado:* [[PRD-08-03 Deploy AWS]]  
*Documento relacionado:* [[PRD-08-05 Seguridad]]
