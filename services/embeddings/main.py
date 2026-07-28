"""services/embeddings/main.py — ConsorcIA Embeddings Service (scaffold inicial).

Spec: PRD-02-02 §4 (Nemotron 3 Embed 1B) y PRD-05-06 (Embeddings y RAG).

El modelo de embeddings se integra en PRD-05-06. Este scaffold expone
/health (requerido por docker-compose) y un stub de POST /embed que
devuelve 501 hasta que el modelo esté integrado. Los vectores se
persisten en PostgreSQL vía pgvector (PRD-02-04).
"""

import os

from fastapi import FastAPI, HTTPException

app = FastAPI(title="ConsorcIA Embeddings Service", version="0.1.0")

MODEL_NAME = os.getenv("MODEL_NAME", "nvidia/Nemotron-3-Embed-1B")


@app.get("/health")
def health():
    return {
        "status": "ok",
        "service": "consorcia-embeddings",
        "model": MODEL_NAME,
        "model_loaded": False,
    }


@app.post("/embed")
def embed():
    """Generación de embeddings para RAG (ver PRD-05-06)."""
    raise HTTPException(
        status_code=501,
        detail=(
            f"Modelo {MODEL_NAME} no integrado aún. "
            "Implementación prevista en PRD-05-06 (Embeddings y RAG)."
        ),
    )
