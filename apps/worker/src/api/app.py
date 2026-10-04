from __future__ import annotations

from fastapi import FastAPI, HTTPException

from config.settings import settings
from inference.engine import LlamaCppEngine
from inference.service import InferenceService
from inference.types import InferenceRequest

from api.schema import (
    InferenceRequestBody,
    InferenceResponseBody,
)


def create_app() -> FastAPI:
    app = FastAPI(
        title="Decentralized LLM Worker",
        version="0.1.0",
    )

    engine = LlamaCppEngine(
        model_path=settings.model_path,
        n_ctx=settings.context_size,
        n_gpu_layers=settings.gpu_layers,
    )

    inference_service = InferenceService(engine)

    app.state.inference_service = inference_service

    @app.get("/health")
    def health() -> dict[str, str]:
        return {
            "status": "ok",
            "workerId": settings.worker_id,
        }

    @app.post(
        "/api/v1/inference",
        response_model=InferenceResponseBody,
    )
    def inference(
        body: InferenceRequestBody,
    ) -> InferenceResponseBody:
        if body.model != settings.model_name:
            raise HTTPException(
                status_code=400,
                detail=f"Model '{body.model}' is not available on this worker.",
            )

        request = InferenceRequest(
            request_id=body.request_id,
            model=body.model,
            prompt=body.prompt,
            max_tokens=body.max_tokens,
            temperature=body.temperature,
        )

        response = inference_service.infer(request)

        return InferenceResponseBody(
            request_id=response.request_id,
            model=response.model,
            text=response.text,
        )

    return app


app = create_app()
