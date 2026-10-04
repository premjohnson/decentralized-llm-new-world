from __future__ import annotations

from pathlib import Path
from typing import Any

from aggregation.fedavg import FedAvgAggregator
from aggregation.types import AdapterArtifact
from config.settings import settings


class AggregationService:
    """Application service for federated adapter aggregation."""

    def __init__(self) -> None:
        self.aggregator = FedAvgAggregator()

    def aggregate(
        self,
        payload: dict[str, Any],
        *,
        task_id: str,
        job_id: str,
        worker_id: str,
    ) -> dict[str, Any]:
        if not isinstance(payload, dict):
            raise ValueError(
                "Aggregation task payload must be an object."
            )

        self._validate_identity(
            task_id=task_id,
            job_id=job_id,
            worker_id=worker_id,
        )

        model_name = payload.get("modelName")

        if not isinstance(model_name, str) or not model_name.strip():
            raise ValueError(
                "Aggregation task requires a non-empty 'modelName'."
            )

        artifacts = payload.get("artifacts")

        if not isinstance(artifacts, list):
            raise ValueError(
                "Aggregation task requires 'artifacts' as an array."
            )

        if not artifacts:
            raise ValueError(
                "Aggregation requires at least one adapter artifact."
            )

        adapter_artifacts: list[AdapterArtifact] = []

        for index, artifact in enumerate(artifacts):
            if not isinstance(artifact, dict):
                raise ValueError(
                    f"Aggregation artifact {index} must be an object."
                )

            path = artifact.get("path")
            sample_count = artifact.get("sampleCount")

            if not isinstance(path, str) or not path.strip():
                raise ValueError(
                    f"Aggregation artifact {index} requires a non-empty 'path'."
                )

            if (
                isinstance(sample_count, bool)
                or not isinstance(sample_count, int)
                or sample_count <= 0
            ):
                raise ValueError(
                    f"Aggregation artifact {index} requires "
                    "'sampleCount' to be a positive integer."
                )

            artifact_path = Path(path)

            if not artifact_path.is_file():
                raise FileNotFoundError(
                    f"Aggregation artifact not found: {artifact_path}"
                )

            adapter_artifacts.append(
                AdapterArtifact(
                    path=str(artifact_path.resolve()),
                    sample_count=sample_count,
                )
            )

        output_directory = self._build_output_directory(
            job_id=job_id,
            task_id=task_id,
            worker_id=worker_id,
        )

        output_path = (
            output_directory
            / "global_adapter.safetensors"
        )

        result = self.aggregator.aggregate(
            artifacts=adapter_artifacts,
            output_path=output_path,
        )

        result_dict = result.to_dict()

        # The worker-level artifacts are LoRA adapters.
        # The FedAvg output is the aggregated/global artifact,
        # therefore it is registered as a model checkpoint.
        result_dict["artifact"] = {
            "jobId": job_id,
            "taskId": task_id,
            "workerId": worker_id,
            "artifactType": "model_checkpoint",
            "storageUri": result.output_path,
            "sha256": result.sha256,
            "sizeBytes": result.size_bytes,
            "modelName": model_name,
            "format": "safetensors",
            "workerCount": result.worker_count,
            "totalSamples": result.total_samples,
        }

        return result_dict

    @staticmethod
    def _build_output_directory(
        *,
        job_id: str,
        task_id: str,
        worker_id: str,
    ) -> Path:
        artifact_root = Path(settings.artifact_root)

        output_directory = (
            artifact_root
            / "jobs"
            / AggregationService._safe_path_component(
                job_id,
                "job_id",
            )
            / "tasks"
            / AggregationService._safe_path_component(
                task_id,
                "task_id",
            )
            / f"worker-{AggregationService._safe_path_component(worker_id, 'worker_id')}"
            / "global"
        )

        output_directory.mkdir(
            parents=True,
            exist_ok=True,
        )

        return output_directory

    @staticmethod
    def _safe_path_component(
        value: str,
        field_name: str,
    ) -> str:
        if not isinstance(value, str) or not value.strip():
            raise ValueError(
                f"'{field_name}' must be a non-empty string."
            )

        value = value.strip()

        if value in {".", ".."}:
            raise ValueError(
                f"'{field_name}' contains an invalid path component."
            )

        if "/" in value or "\\" in value:
            raise ValueError(
                f"'{field_name}' must not contain path separators."
            )

        return value

    @staticmethod
    def _validate_identity(
        *,
        task_id: str,
        job_id: str,
        worker_id: str,
    ) -> None:
        AggregationService._safe_path_component(
            task_id,
            "task_id",
        )

        AggregationService._safe_path_component(
            job_id,
            "job_id",
        )

        AggregationService._safe_path_component(
            worker_id,
            "worker_id",
        )