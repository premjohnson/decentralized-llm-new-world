from __future__ import annotations

from time import perf_counter

from inference.engine import InferenceEngine
from inference.types import InferenceRequest, InferenceResponse


class InferenceService:
    """Application service responsible for executing inference requests."""

    def __init__(self, engine: InferenceEngine) -> None:
        self._engine = engine

    def infer(self, request: InferenceRequest) -> InferenceResponse:
        started_at = perf_counter()

        response = self._engine.infer(request)

        latency_ms = (perf_counter() - started_at) * 1000

        print(
            "Inference completed | "
            f"request_id={request.request_id} | "
            f"model={request.model} | "
            f"latency_ms={latency_ms:.2f}"
        )

        return response
