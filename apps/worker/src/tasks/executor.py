from __future__ import annotations

from typing import Any

from aggregation.service import AggregationService
from evaluation.service import EvaluationService
from inference.engine import LlamaCppEngine
from inference.service import InferenceService
from inference.types import InferenceRequest
from training.service import TrainingService


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

        self.inference_service = InferenceService(self.engine)
        self.training_service = TrainingService()
        self.aggregation_service = AggregationService()
        self.evaluation_service = EvaluationService()

    def execute(
        self,
        task: dict[str, Any],
    ) -> dict[str, Any]:
        task_type = task.get("taskType")

        if task_type == "inference":
            return self._execute_inference(task)

        if task_type == "training":
            return self._execute_training(task)

        if task_type == "aggregation":
            return self._execute_aggregation(task)

        if task_type == "evaluation":
            return self._execute_evaluation(task)

        raise UnsupportedTaskError(
            f"Task type '{task_type}' is not implemented by this worker."
        )

    def _execute_inference(
        self,
        task: dict[str, Any],
    ) -> dict[str, Any]:
        payload = task.get("payload")

        if not isinstance(payload, dict):
            raise ValueError(
                "Inference task payload must be an object."
            )

        model_name = payload.get(
            "modelName",
            self.model_name,
        )

        if (
            not isinstance(model_name, str)
            or not model_name.strip()
        ):
            raise ValueError(
                "Inference task requires a non-empty 'modelName'."
            )

        prompt = payload.get("prompt")

        if (
            not isinstance(prompt, str)
            or not prompt.strip()
        ):
            raise ValueError(
                "Inference task requires a non-empty 'prompt'."
            )

        max_tokens = payload.get(
            "maxTokens",
            128,
        )

        if (
            isinstance(max_tokens, bool)
            or not isinstance(max_tokens, int)
            or max_tokens <= 0
        ):
            raise ValueError(
                "'maxTokens' must be a positive integer."
            )

        temperature = payload.get(
            "temperature",
            0.7,
        )

        if (
            isinstance(temperature, bool)
            or not isinstance(temperature, (int, float))
            or temperature < 0
        ):
            raise ValueError(
                "'temperature' must be a non-negative number."
            )

        request = InferenceRequest(
            request_id=str(
                task.get("taskId", "")
            ),
            model_name=model_name,
            prompt=prompt,
            max_tokens=max_tokens,
            temperature=float(temperature),
        )

        result = self.inference_service.generate(
            request
        )

        return {
            "requestId": request.request_id,
            "modelName": result.model_name,
            "text": result.text,
        }

    def _execute_training(
        self,
        task: dict[str, Any],
    ) -> dict[str, Any]:
        payload = task.get("payload")

        if not isinstance(payload, dict):
            raise ValueError(
                "Training task payload must be an object."
            )

        task_id = self._require_identity(
            task,
            "taskId",
            "Training",
        )

        job_id = self._require_identity(
            task,
            "jobId",
            "Training",
        )

        worker_id = self._require_identity(
            task,
            "workerId",
            "Training",
        )

        return self.training_service.train(
            payload=payload,
            task_id=task_id,
            job_id=job_id,
            worker_id=worker_id,
        )

    def _execute_aggregation(
        self,
        task: dict[str, Any],
    ) -> dict[str, Any]:
        payload = task.get("payload")

        if not isinstance(payload, dict):
            raise ValueError(
                "Aggregation task payload must be an object."
            )

        task_id = self._require_identity(
            task,
            "taskId",
            "Aggregation",
        )

        job_id = self._require_identity(
            task,
            "jobId",
            "Aggregation",
        )

        worker_id = self._require_identity(
            task,
            "workerId",
            "Aggregation",
        )

        return self.aggregation_service.aggregate(
            payload=payload,
            task_id=task_id,
            job_id=job_id,
            worker_id=worker_id,
        )

    def _execute_evaluation(
        self,
        task: dict[str, Any],
    ) -> dict[str, Any]:
        payload = task.get("payload")

        if not isinstance(payload, dict):
            raise ValueError(
                "Evaluation task payload must be an object."
            )

        task_id = self._require_identity(
            task,
            "taskId",
            "Evaluation",
        )

        job_id = self._require_identity(
            task,
            "jobId",
            "Evaluation",
        )

        worker_id = self._require_identity(
            task,
            "workerId",
            "Evaluation",
        )

        return self.evaluation_service.execute(
            payload=payload,
            task_id=task_id,
            job_id=job_id,
            worker_id=worker_id,
        )

    @staticmethod
    def _require_identity(
        task: dict[str, Any],
        field_name: str,
        task_name: str,
    ) -> str:
        value = task.get(field_name)

        if (
            not isinstance(value, str)
            or not value.strip()
        ):
            raise ValueError(
                f"{task_name} task requires a "
                f"non-empty '{field_name}'."
            )

        return value