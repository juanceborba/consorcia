"""services/ocr/main.py — ConsorcIA OCR Service (scaffold inicial).

Spec: PRD-02-02 §8 (baidu/Unlimited-OCR sobre FastAPI).

El modelo Unlimited-OCR requiere GPU NVIDIA (CUDA 12.9). En desarrollo local
sin GPU el servicio levanta igual: /health responde OK y POST /parse devuelve
501 hasta que el modelo esté disponible (host con GPU o fallback a
Nemotron Nano 12B VL vía API).
"""

import os

from fastapi import FastAPI, HTTPException

app = FastAPI(title="ConsorcIA OCR Service", version="0.1.0")

MODEL_PATH = os.getenv("MODEL_PATH", "/models/unlimited-ocr")
# El modelo se carga lazy en el primer /parse cuando haya GPU disponible.
_model = None


@app.get("/health")
def health():
    return {
        "status": "ok",
        "service": "consorcia-ocr",
        "model_loaded": _model is not None,
        "model_path": MODEL_PATH,
    }


@app.post("/parse")
def parse_document():
    """Parseo de PDFs de expensas con Unlimited-OCR (requiere GPU)."""
    if _model is None:
        raise HTTPException(
            status_code=501,
            detail=(
                "Modelo Unlimited-OCR no cargado: requiere GPU NVIDIA. "
                "Levantar con profile gpu en un host CUDA, o usar "
                "Nemotron Nano 12B VL como fallback (PRD-02-02 §8.3)."
            ),
        )
    # TODO(PRD-04-07 Importación Inteligente): implementar parseo real.
    raise HTTPException(status_code=501, detail="No implementado aún")
