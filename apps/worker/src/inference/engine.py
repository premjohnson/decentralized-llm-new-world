from __future__ import annotations

from abc import ABC, abstractmethod
from pathlib import Path

from llama_cpp import Llama

from inference.types import (
    InferenceRequest,
    InferenceResponse,
)


class InferenceEngine(ABC):
    """Interface implemented by concrete LLM inference engines."""

    @abstractmethod
    def infer(
        self,
        request: InferenceRequest,
    ) -> InferenceResponse:
        """Execute one inference request."""
        raise NotImplementedError


class LlamaCppEngine(InferenceEngine):
    """LLM inference engine backed by llama.cpp."""

    def __init__(
        self,
        model_path: str,
        *,
        n_ctx: int = 2048,
        n_gpu_layers: int = -1,
        n_threads: int | None = None,
    ) -> None:
        model = Path(model_path)

        if not model.is_file():
            raise FileNotFoundError(
                f"GGUF model not found: {model}"
            )

        self._llm = Llama(
            model_path=str(model),
            n_ctx=n_ctx,
            n_gpu_layers=n_gpu_layers,
            n_threads=n_threads,
            verbose=False,
        )

    def infer(
        self,
        request: InferenceRequest,
    ) -> InferenceResponse:
        result = self._llm(
            request.prompt,
            max_tokens=request.max_tokens,
            temperature=request.temperature,
        )

        text = result["choices"][0]["text"]

        return InferenceResponse(
            request_id=request.request_id,
            model=request.model,
            text=text.strip(),
        )