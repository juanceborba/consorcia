---
title: "PRD-08-03: Deploy AWS"
description: "Arquitectura de despliegue en AWS: ECS Fargate, RDS, ElastiCache, S3, CloudFront, ALB y configuracion de infraestructura como codigo."
author: "ConsorcIA Team"
date: 2026-07-26
status: "vigente"
priority: "P0"
tags: [devops, aws, deploy, ecs, fargate, rds, s3, cloudfront, terraform, consorcIA]
outcomes:
  - "Disenar la arquitectura AWS de ConsorcIA"
  - "Configurar ECS Fargate para API y workers"
  - "Implementar RDS PostgreSQL y ElastiCache Redis"
  - "Establecer S3 + CloudFront para assets y documentos"
  - "Documentar infraestructura como codigo con Terraform"
---

# PRD-08-03: Deploy AWS

> **ConsorcIA se despliega en AWS usando ECS Fargate, RDS, ElastiCache, S3 y CloudFront.** La infraestructura esta definida como codigo con Terraform para reproducibilidad y control de versiones.

---

## 1. Arquitectura AWS

### 1.1 Diagrama de alto nivel

```
                              Internet
                                 |
                    +------------+------------+
                    |      CloudFront         |
                    |    (CDN + WAF)          |
                    +------------+------------+
                                 |
                    +------------+------------+
                    |      Route 53           |
                    |    (DNS + Health)       |
                    +------------+------------+
                                 |
                    +------------+------------+
                    |    Application LB       |
                    |    (HTTPS termination)  |
                    +------------+------------+
                                 |
              +------------------+------------------+
              |                  |                  |
       +------v------+    +-----v------+    +-----v------+
       |  ECS API    |    | ECS Agent  |    | ECS Front  |
       |  (Fargate)  |    | Worker     |    | (Fargate)  |
       |  2 tasks    |    | (Fargate)  |    |  2 tasks   |
       +------+------+    +-----+------+    +-----+------+
              |                 |                 |
       +------v------+    +-----v------+    +-----v------+
       |    RDS      |    |ElastiCache |    |    S3      |
       | PostgreSQL  |    |   Redis    |    |  Assets    |
       |  (Multi-AZ) |    |            |    |  Documents |
       +-------------+    +------------+    +------------+
              |
       +------v------+
       |  Secrets    |
       |  Manager    |
       +-------------+
```

---

## 2. Servicios AWS

### 2.1 ECS Fargate

| Servicio | Task Definition | CPU | Memoria | Tasks |
|----------|----------------|-----|---------|-------|
| **API** | consorcia-api | 1 vCPU | 2 GB | 2 (min) - 10 (max) |
| **Agent Worker** | consorcia-worker | 1 vCPU | 2 GB | 2 (min) - 5 (max) |
| **Frontend** | consorcia-frontend | 0.5 vCPU | 1 GB | 2 (min) - 5 (max) |

**Auto Scaling:**
```hcl
resource "aws_appautoscaling_target" "api" {
  max_capacity       = 10
  min_capacity       = 2
  resource_id        = "service/${aws_ecs_cluster.main.name}/${aws_ecs_service.api.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}

resource "aws_appautoscaling_policy" "api_cpu" {
  name               = "api-cpu-autoscaling"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.api.resource_id
  scalable_dimension = aws_appautoscaling_target.api.scalable_dimension
  service_namespace  = aws_appautoscaling_target.api.service_namespace

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
    target_value = 70.0
  }
}
```

### 2.2 RDS PostgreSQL

| Configuracion | Valor |
|---------------|-------|
| **Engine** | PostgreSQL 16 |
| **Instance** | db.t3.medium (staging) / db.r6g.large (prod) |
| **Multi-AZ** | Si (produccion) |
| **Backup** | 7 dias (staging) / 30 dias (prod) |
| **Encryption** | Si (KMS) |
| **Public** | No (private subnet) |

### 2.3 ElastiCache Redis

| Configuracion | Valor |
|---------------|-------|
| **Engine** | Redis 7 |
| **Node type** | cache.t3.micro (staging) / cache.r6g.large (prod) |
| **Cluster mode** | Disabled (staging) / Enabled (prod) |
| **Encryption** | In-transit + at-rest |

### 2.4 S3

| Bucket | Proposito | Politica |
|--------|-----------|----------|
| `consorcia-assets` | Assets estaticos (frontend build) | CloudFront OAI |
| `consorcia-documents` | Documentos de consorcios | Private, presigned URLs |
| `consorcia-backups` | Backups de BD y documentos | Glacier despues de 90 dias |

### 2.5 CloudFront

| Configuracion | Valor |
|---------------|-------|
| **Origin** | S3 (assets) + ALB (API) |
| **SSL** | ACM certificate |
| **WAF** | AWS WAF (rate limiting, SQL injection) |
| **Caching** | 1 ano para assets, 0 para API |

---

## 3. Terraform

### 3.1 Estructura

```
terraform/
|-- modules/
|   |-- vpc/
|   |-- ecs/
|   |-- rds/
|   |-- elasticache/
|   |-- s3/
|   |-- cloudfront/
|   |-- alb/
|-- environments/
|   |-- staging/
|   |   |-- main.tf
|   |   |-- variables.tf
|   |   |-- terraform.tfvars
|   |-- production/
|   |   |-- main.tf
|   |   |-- variables.tf
|   |   |-- terraform.tfvars
|-- backend.tf
```

### 3.2 Backend state

```hcl
# backend.tf
terraform {
  backend "s3" {
    bucket         = "consorcia-terraform-state"
    key            = "infrastructure/terraform.tfstate"
    region         = "us-east-1"
    encrypt        = true
    dynamodb_table = "consorcia-terraform-locks"
  }
}
```

---

## 4. Networking

### 4.1 VPC

```
VPC: 10.0.0.0/16
|
|-- Public Subnets
|   |-- 10.0.1.0/24 (AZ-a)
|   |-- 10.0.2.0/24 (AZ-b)
|   |-- 10.0.3.0/24 (AZ-c)
|   |-- ALB, NAT Gateway
|
|-- Private Subnets (App)
|   |-- 10.0.10.0/24 (AZ-a)
|   |-- 10.0.11.0/24 (AZ-b)
|   |-- 10.0.12.0/24 (AZ-c)
|   |-- ECS Tasks
|
|-- Private Subnets (Data)
    |-- 10.0.20.0/24 (AZ-a)
    |-- 10.0.21.0/24 (AZ-b)
    |-- 10.0.22.0/24 (AZ-c)
    |-- RDS, ElastiCache
```

---

## 5. Costos Estimados (Produccion)

| Servicio | Costo mensual (USD) |
|----------|---------------------|
| ECS Fargate (API + Workers) | ~$200 |
| RDS PostgreSQL (db.r6g.large) | ~$250 |
| ElastiCache Redis | ~$100 |
| S3 (1TB) | ~$25 |
| CloudFront | ~$50 |
| ALB | ~$20 |
| WAF | ~$30 |
| Secrets Manager | ~$5 |
| **Total estimado** | **~$680/mes** |

---

## 6. Decisiones de Diseno

| Decision | Eleccion | Justificacion |
|----------|----------|---------------|
| **ECS Fargate** | Sobre EKS | Sin necesidad de Kubernetes. Serverless containers. |
| **RDS** | Sobre Aurora | PostgreSQL nativo. Menor costo para carga predecible. |
| **ElastiCache** | Sobre self-hosted Redis | Managed service. Backups automaticos. |
| **CloudFront** | Sobre Cloudflare | Integracion nativa con S3 y ALB. WAF incluido. |
| **Terraform** | Sobre CDK/CloudFormation | Multi-cloud potencial. Estado en S3. |
| **Multi-AZ** | Solo en produccion | Costo de staging controlado. |

---

*Documento relacionado:* [[PRD-02-03 Infraestructura Docker]]  
*Documento relacionado:* [[PRD-08-02 CI:CD]]  
*Documento relacionado:* [[PRD-08-04 Monitoring]]
