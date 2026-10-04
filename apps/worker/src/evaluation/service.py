from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

from .evaluator import ModelEvaluator


class EvaluationService:
    def __init__(self, artifact_root: str = "artifacts") -> None:
        self.artifact_root = Path(artifact_root)

    def execute(
        self,
        *,
        job_id: str,
        task_id: str,
        worker_id: str,
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        model_name = payload.get("modelName")

        if not isinstance(model_name, str) or not model_name.strip():
            raise ValueError("Evaluation payload requires modelName.")

        dataset = payload.get("dataset")

        if not isinstance(dataset, list) or not dataset:
            raise ValueError(
                "Evaluation payload requires a non-empty dataset."
            )

        if not all(isinstance(sample, str) for sample in dataset):
            raise ValueError(
                "Evaluation dataset must contain only strings."
            )

        max_length = payload.get("maxLength", 512)

        if not isinstance(max_length, int) or max_length <= 0:
            raise ValueError(
                "maxLength must be a positive integer."
            )

        output_dir = (
            self.artifact_root
            / "jobs"
            / job_id
            / "tasks"
            / task_id
            / f"worker-{worker_id}"
            / "evaluation"
        )

        output_dir.mkdir(parents=True, exist_ok=True)

        evaluator = ModelEvaluator(
            model_name=model_name,
            max_length=max_length,
        )

        result = evaluator.evaluate(dataset)

        result_path = output_dir / "evaluation.json"

        result_payload = {
            "jobId": job_id,
            "taskId": task_id,
            "workerId": worker_id,
            "modelName": result.model_name,
            "sampleCount": result.sample_count,
            "averageLoss": result.average_loss,
            "perplexity": result.perplexity,
            "metrics": result.metrics,
            "metadata": result.metadata,
        }

        result_path.write_text(
            json.dumps(
                result_payload,
                indent=2,
                sort_keys=True,
            ),
            encoding="utf-8",
        )

        content = result_path.read_bytes()
        sha256 = hashlib.sha256(content).hexdigest()

        return {
            "artifact": {
                "jobId": job_id,
                "taskId": task_id,
                "workerId": worker_id,
                "artifactType": "evaluation_result",
                "storageUri": str(result_path.resolve()),
                "sha256": sha256,
                "sizeBytes": len(content),
                "sampleCount": result.sample_count,
                "modelName": model_name,
                "format": "json",
            },
            "evaluation": result_payload,
        }