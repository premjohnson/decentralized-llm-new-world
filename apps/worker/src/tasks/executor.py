from __future__ import annotations

from typing import Any

from inference.engine import LlamaCppEngine
from inference.service import InferenceService
from inference.types import InferenceRequest


class UnsupportedTaskError(Exception):
    """Raised when the worker does not support a task type."""


class TaskExecutor:
    def __init__(
        self,
        model_path: str,
        context_size: int,
        gpu_layers: int,
        model_name: str,
    ) -> None:
        self.model_name = model_name

        self.engine = LlamaCppEngine(
            model_path=model_path,
            n_ctx=context_size,
            n_gpu_layers=gpu_layers,
        )

        self.inference_service = InferenceService(
            self.engine,
        )

    def execute(
        self,
        task: dict[str, Any],
    ) -> dict[str, Any]:
        task_type = task.get("taskType")

        if task_type == "inference":
            return self._execute_inference(task)

        raise UnsupportedTaskError(
            f"Task type '{task_type}' is not "
            "implemented by this worker."
        )

    def _execute_inference(
        self,
        task: dict[str, Any],
    ) -> dict[str, Any]:
        payload = task.get("payload")

        if not isinstance(payload, dict):
            raise ValueError(
                "Task payload must be an object."
            )

        model_name = payload.get("modelName")

        if model_name != self.model_name:
            raise ValueError(
                f"Model '{model_name}' is not available "
                f"on this worker. Expected '{self.model_name}'."
            )

        prompt = payload.get("prompt")

        if not isinstance(prompt, str) or not prompt.strip():
            raise ValueError(
                "Inference task requires a non-empty "
                "'prompt'."
            )

        request_id = payload.get(
            "requestId",
            task["taskId"],
        )

        max_tokens = payload.get(
            "maxTokens",
            128,
        )

        temperature = payload.get(
            "temperature",
            0.7,
        )

        if (
            not isinstance(max_tokens, int)
            or max_tokens <= 0
        ):
            raise ValueError(
                "'maxTokens' must be a positive integer."
            )

        if (
            not isinstance(temperature, (int, float))
            or temperature < 0
        ):
            raise ValueError(
                "'temperature' must be a non-negative number."
            )

        request = InferenceRequest(
            request_id=str(request_id),
            model=model_name,
            prompt=prompt,
            max_tokens=max_tokens,
            temperature=float(temperature),
        )

        response = self.inference_service.infer(
            request,
        )

        return {
            "requestId": response.request_id,
            "model": response.model,
            "text": response.text,
        }