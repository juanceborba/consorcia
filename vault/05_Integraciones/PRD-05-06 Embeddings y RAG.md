---
title: "PRD-05-06: Embeddings y RAG"
description: "Especificacion del sistema de Retrieval-Augmented Generation: generacion de embeddings con Nemotron 3 Embed 1B, almacenamiento en pgvector, y pipeline de RAG para consultas de agentes y habitantes."
author: "ConsorcIA Team"
date: 2026-07-28
status: "vigente"
priority: "P1"
tags: [embeddings, rag, pgvector, nemotron, retrieval, vectores, consorcIA]
outcomes:
  - "Definir arquitectura de pipeline RAG end-to-end"
  - "Especificar modelo de embeddings y chunking strategy"
  - "Disenar esquema de vectores en PostgreSQL con pgvector"
  - "Establecer estrategia de retrieval hibrido (semantico + keyword)"
  - "Documentar casos de uso: chatbot, consultas legales, FAQ"
---

# PRD-05-06: Embeddings y RAG

> **El sistema de RAG (Retrieval-Augmented Generation) permite que los agentes IA respondan consultas con informacion precisa y actualizada del consorcio, sin alucinar. Usa Nemotron 3 Embed 1B (gratis en OpenRouter) para generar embeddings, pgvector para almacenarlos, y retrieval hibrido para encontrar los chunks mas relevantes.**

---

## 1. Arquitectura de RAG

### 1.1 Pipeline completo

```
DOCUMENTOS FUENTE
        |
        v
+-----------------------------+
| 1. INGESTA                  | -> PDFs, actas, reglamentos, FAQ
|    - Upload por admin       |    comunicados, tickets resueltos
|    - Importacion automatica |
+-------------+---------------+
              |
              v
+-----------------------------+
| 2. CHUNKING                 | -> Dividir en fragmentos de
|    - Por parrafo (default)  |    ~500-1000 tokens con overlap
|    - Por seccion (legales)  |    de 100 tokens
|    - Por tabla (datos)      |
+-------------+---------------+
              |
              v
+-----------------------------+
| 3. EMBEDDINGS               | -> Nemotron 3 Embed 1B
|    - Modelo: nemotron-3-    |    (gratis en OpenRouter)
|      embed-1b               |    - 1024 dimensiones
|    - Batch: 32 chunks       |    - Normalizados (cosine similarity)
+-------------+---------------+
              |
              v
+-----------------------------+
| 4. ALMACENAMIENTO           | -> PostgreSQL + pgvector
|    - Tabla: document_chunks |    - Indice IVFFlat para busqueda
|    - Vector: 1024 dims      |      rapida
|    - Metadata: organizacion |    - Filtrado por organizacion
|      _id, edificio_id,      |      (y edificio cuando aplica)
|      doc_type, source_url   |
+-------------+---------------+
              |
              v
+-----------------------------+
| 5. RETRIEVAL                | -> Consulta del usuario
|    - Embedding de query     |    -> Top-k chunks mas relevantes
|    - Similarity search      |    -> Filtrado por organizacion_id
|    - Re-ranking (opcional)  |       (+ edificio_id si aplica)
|                             |    -> Re-ranking por relevancia
+-------------+---------------+
              |
              v
+-----------------------------+
| 6. GENERACION               | -> Nemotron Super 49B / Kimi K2
|    - Prompt: query + chunks |    -> Respuesta fundamentada
|    - Instruccion: "Responde |       en documentos
|      basandote SOLO en la   |
|      informacion provista"  |
+-----------------------------+
```

---

## 2. Modelo de Embeddings

### 2.1 Nemotron 3 Embed 1B

| Caracteristica | Valor |
|----------------|-------|
| **Modelo** | nemotron-3-embed-1b |
| **Proveedor** | OpenRouter (gratis) / NVIDIA NIM |
| **Dimensiones** | 1024 |
| **Contexto maximo** | 8192 tokens |
| **Costo** | $0 (OpenRouter) |
| **Normalizacion** | L2 (cosine similarity) |
| **Idiomas** | Multilingue (espanol optimizado) |

### 2.2 Comparativa de modelos de embeddings

| Modelo | Dimensiones | Costo/1M | Calidad (MTEB) |
|--------|-------------|----------|----------------|
| Nemotron 3 Embed 1B | 1024 | **$0** | 62.3 |
| text-embedding-3-large | 3072 | $0.13 | 64.6 |
| text-embedding-ada-002 | 1536 | $0.10 | 61.0 |
| bge-large-en-v1.5 | 1024 | $0.02 | 64.2 |

> **Nemotron 3 Embed 1B es gratis y tiene calidad comparable a modelos pagos. Ideal para escalar sin costo.**

---

## 3. Chunking Strategy

### 3.1 Estrategias por tipo de documento

| Tipo de documento | Estrategia | Tamano chunk | Overlap |
|-------------------|------------|--------------|---------|
| **Reglamento de PH** | Por articulo | ~800 tokens | 100 tokens |
| **Actas de asamblea** | Por tema/seccion | ~600 tokens | 100 tokens |
| **Comunicados** | Por parrafo | ~400 tokens | 50 tokens |
| **FAQ** | Por pregunta+respuesta | ~300 tokens | 0 |
| **Tickets resueltos** | Por ticket (resumen) | ~500 tokens | 0 |
| **Facturas** | Por concepto | ~200 tokens | 0 |
| **Ley 941 / CCyC** | Por articulo | ~500 tokens | 100 tokens |

### 3.2 Metadata por chunk

```typescript
interface DocumentChunk {
  id: string;
  embedding: number[];           // 1024 floats

  // Contenido
  texto: string;
  textoNormalizado: string;      // Minusculas, sin tildes (para keyword search)

  // Metadata
  organizacionId: string;        // Organizacion (tenant raiz)
  edificioId?: string;           // Edificio, cuando el documento es propio de un edificio
  documentoId: string;           // ID del documento origen
  tipoDocumento: 'reglamento' | 'acta' | 'comunicado' | 'faq' | 'ticket' | 'ley' | 'otro';
  sourceUrl: string;             // URL en MinIO/S3
  pagina?: number;               // Numero de pagina (PDFs)

  // Contexto
  tituloSeccion?: string;        // Titulo de la seccion
  articulo?: string;             // Numero de articulo (legales)
  fechaDocumento?: Date;         // Fecha del documento origen

  createdAt: Date;
}
```

---

## 4. Almacenamiento en PostgreSQL + pgvector

### 4.1 Esquema de base de datos

```sql
-- Extension pgvector
CREATE EXTENSION IF NOT EXISTS vector;

-- Tabla de chunks
CREATE TABLE document_chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    embedding VECTOR(1024) NOT NULL,
    texto TEXT NOT NULL,
    texto_normalizado TEXT NOT NULL,

    organizacion_id UUID NOT NULL REFERENCES organizaciones(id),
    edificio_id UUID REFERENCES edificios(id),
    documento_id UUID NOT NULL,
    tipo_documento VARCHAR(50) NOT NULL,
    source_url TEXT,
    pagina INTEGER,

    titulo_seccion TEXT,
    articulo TEXT,
    fecha_documento DATE,

    created_at TIMESTAMP DEFAULT NOW(),

    -- Scope: siempre por organizacion; edificio_id cuando el documento es de un edificio
    CONSTRAINT fk_organizacion FOREIGN KEY (organizacion_id) REFERENCES organizaciones(id),
    CONSTRAINT fk_edificio FOREIGN KEY (edificio_id) REFERENCES edificios(id)
);

-- Indice IVFFlat para busqueda rapida (cosine similarity)
CREATE INDEX idx_chunks_embedding ON document_chunks
USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);  -- Ajustar segun cantidad de chunks (~1000 por lista)

-- Indice para filtrado por organizacion (+ edificio) + tipo
CREATE INDEX idx_chunks_org_tipo ON document_chunks(organizacion_id, edificio_id, tipo_documento);

-- Indice para keyword search (full-text)
CREATE INDEX idx_chunks_texto_search ON document_chunks
USING gin(to_tsvector('spanish', texto_normalizado));
```

### 4.2 Query de retrieval hibrido

```sql
-- Busqueda semantica + keyword con re-ranking
WITH semantic_results AS (
    SELECT
        id,
        texto,
        1 - (embedding <=> $query_embedding) AS similarity,
        tipo_documento
    FROM document_chunks
    WHERE organizacion_id = $organizacion_id
      AND edificio_id = $edificio_id
    ORDER BY embedding <=> $query_embedding
    LIMIT 20
),
keyword_results AS (
    SELECT
        id,
        texto,
        ts_rank(to_tsvector('spanish', texto_normalizado), plainto_tsquery('spanish', $query_text)) AS rank,
        tipo_documento
    FROM document_chunks
    WHERE organizacion_id = $organizacion_id
      AND edificio_id = $edificio_id
      AND to_tsvector('spanish', texto_normalizado) @@ plainto_tsquery('spanish', $query_text)
    ORDER BY rank DESC
    LIMIT 20
),
combined AS (
    SELECT id, texto, similarity, 0 AS rank, 'semantic' AS source FROM semantic_results
    UNION ALL
    SELECT id, texto, 0 AS similarity, rank, 'keyword' AS source FROM keyword_results
)
SELECT
    id,
    texto,
    MAX(similarity) + MAX(rank) * 0.5 AS combined_score,
    STRING_AGG(DISTINCT source, ', ') AS sources
FROM combined
GROUP BY id, texto
ORDER BY combined_score DESC
LIMIT 5;
```

---

## 5. Casos de Uso

### 5.1 Chatbot del portal (Agente Comunicador)

```
Usuario: "Puedo tener perro en el departamento?"
        |
        v
+-----------------------------+
| 1. Embedding de query       | -> Nemotron 3 Embed 1B
+-----------------------------+
        |
        v
+-----------------------------+
| 2. Retrieval en pgvector    | -> Top 5 chunks del reglamento
|    (scope organizacion +    |    + actas + FAQ
|     edificio)               |
+-----------------------------+
        |
        v
+-----------------------------+
| 3. Generacion               | -> Nemotron Super 49B
|    Prompt:                  |
|    "Basandote en la         |
|    siguiente informacion,    |
|    responde la consulta..." |
+-----------------------------+
        |
        v
"Segun el reglamento de PH art. 12, se permiten
mascotas de hasta 10kg con previa autorizacion
del consorcio. Debes presentar una nota al
administrador..."
```

### 5.2 Consultas legales (Agente Documental)

```
Admin: "Como se distribuye un gasto de reparacion
         del ascensor?"
        |
        v
Retrieval: Articulos 2049, 2050, 2051 del CCyC
           + reglamento del edificio
        |
        v
Respuesta: "Segun el art. 2049 CCyC, los gastos de
reparacion del ascensor se distribuyen entre las
unidades funcionales que lo utilizan (categoria B)..."
```

### 5.3 FAQ automatica

```
Habitante: "Cuando es la proxima asamblea?"
        |
        v
Retrieval: Comunicados recientes + actas
        |
        v
Respuesta: "La proxima asamblea ordinaria esta
programada para el 15 de agosto de 2026, segun
el comunicado enviado el 1 de agosto."
```

---

## 6. Mantenimiento y Actualizacion

### 6.1 Re-indexacion

| Evento | Accion |
|--------|--------|
| Nuevo documento subido | Chunk + embed + insert inmediato |
| Documento actualizado | Delete old chunks + re-chunk + re-embed |
| Documento eliminado | Delete all chunks by documento_id |
| Nuevo edificio creado | Indexar reglamento + actas iniciales |

### 6.2 Monitoreo de calidad

| Metrica | Target | Accion si no se cumple |
|---------|--------|------------------------|
| Retrieval precision | >80% | Ajustar chunk size, re-entrenar re-ranker |
| Respuesta relevancia | >4/5 (eval humano) | Revisar prompts, mejorar contexto |
| Latencia retrieval | <200ms | Optimizar indice IVFFlat, aumentar lists |
| Coverage (docs indexados) | 100% | Alerta si documento no tiene chunks |

---

## 7. Decisiones de Diseno Clave

| Decision | Eleccion | Justificacion |
|----------|----------|---------------|
| **Modelo embeddings** | Nemotron 3 Embed 1B | Gratis, calidad comparable, multilingue. |
| **Vector DB** | pgvector (PostgreSQL) | Sin servicio adicional. Mismo stack que datos. |
| **Chunking** | Por tipo de documento | Mejor precision que chunking uniforme. |
| **Retrieval** | Hibrido (semantico + keyword) | Captura sinonimos (semantic) + terminos exactos (keyword). |
| **Scope por organización** | Siempre filtrar por organizacion_id (+ edificio_id cuando el documento es de un edificio) | Privacidad. Nunca mezclar documentos de organizaciones ni de edificios ajenos. |
| **Re-ranking** | Fase 2 (cross-encoder) | Mejora precision del top-k. No critico para MVP. |
| **Indice** | IVFFlat | Balance precision/velocidad. HNSW para Fase 2 si escala. |

---

*Documento relacionado:* [[PRD-03-05 Agente Comunicador]]
*Documento relacionado:* [[PRD-03-04 Agente Documental]]
*Documento relacionado:* [[PRD-02-04 Base de Datos]]
*Documento relacionado:* [[PRD-05-05 OCR Service]]
*Documento relacionado:* [[PRD-05-03 WhatsApp Business API]]