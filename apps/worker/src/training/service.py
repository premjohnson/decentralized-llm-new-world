from __future__ import annotations

from pathlib import Path
from typing import Any

from config.settings import settings
from training.trainer import (
    LoRATrainer,
    TrainingConfig,
)


class TrainingService:
    """Application service for executing training tasks."""

    def __init__(self) -> None:
        pass

    def train(
        self,
        payload: dict[str, Any],
        *,
        task_id: str,
        job_id: str,
        worker_id: str,
    ) -> dict[str, Any]:
        if not isinstance(payload, dict):
            raise ValueError(
                "Training task payload must be an object."
            )

        self._validate_identity(
            task_id=task_id,
            job_id=job_id,
            worker_id=worker_id,
        )

        model_name = payload.get("modelName")

        if (
            not isinstance(model_name, str)
            or not model_name.strip()
        ):
            raise ValueError(
                "Training task requires a non-empty 'modelName'."
            )

        dataset = payload.get("dataset")

        if not isinstance(dataset, list):
            raise ValueError(
                "Training task requires 'dataset' as an array."
            )

        if not dataset:
            raise ValueError(
                "Training dataset cannot be empty."
            )

        for index, sample in enumerate(dataset):
            if not isinstance(sample, str):
                raise ValueError(
                    f"Training dataset sample {index} "
                    "must be a string."
                )

        # Number of training samples used by this worker.
        #
        # This value is persisted with the artifact and later
        # used by the coordinator for weighted FedAvg.
        sample_count = len(dataset)

        epochs = self._positive_int(
            payload.get("epochs", 1),
            "epochs",
        )

        batch_size = self._positive_int(
            payload.get("batchSize", 1),
            "batchSize",
        )

        max_length = self._positive_int(
            payload.get("maxLength", 128),
            "maxLength",
        )

        learning_rate = payload.get(
            "learningRate",
            2e-4,
        )

        if (
            not isinstance(
                learning_rate,
                (int, float),
            )
            or isinstance(learning_rate, bool)
            or learning_rate <= 0
        ):
            raise ValueError(
                "'learningRate' must be a positive number."
            )

        lora = payload.get("lora", {})

        if not isinstance(lora, dict):
            raise ValueError(
                "'lora' must be an object."
            )

        lora_r = self._positive_int(
            lora.get("r", 8),
            "lora.r",
        )

        lora_alpha = self._positive_int(
            lora.get("alpha", 16),
            "lora.alpha",
        )

        lora_dropout = lora.get(
            "dropout",
            0.05,
        )

        if (
            not isinstance(
                lora_dropout,
                (int, float),
            )
            or isinstance(lora_dropout, bool)
            or not 0 <= lora_dropout < 1
        ):
            raise ValueError(
                "'lora.dropout' must be in [0, 1)."
            )

        gradient_accumulation_steps = (
            self._positive_int(
                payload.get(
                    "gradientAccumulationSteps",
                    1,
                ),
                "gradientAccumulationSteps",
            )
        )

        output_directory = (
            self._build_output_directory(
                job_id=job_id,
                task_id=task_id,
                worker_id=worker_id,
            )
        )

        config = TrainingConfig(
            model_name=model_name,
            output_directory=str(
                output_directory
            ),
            epochs=epochs,
            batch_size=batch_size,
            learning_rate=float(
                learning_rate
            ),
            max_length=max_length,
            lora_r=lora_r,
            lora_alpha=lora_alpha,
            lora_dropout=float(
                lora_dropout
            ),
            gradient_accumulation_steps=(
                gradient_accumulation_steps
            ),
        )

        trainer = LoRATrainer(config)

        result = trainer.train(dataset)

        result_dict = result.to_dict()

        checkpoint = result_dict.get(
            "checkpoint"
        )

        if not isinstance(checkpoint, dict):
            raise ValueError(
                "Training result checkpoint metadata "
                "is invalid."
            )

        checkpoint_path = checkpoint.get(
            "path"
        )

        sha256 = checkpoint.get(
            "sha256"
        )

        size_bytes = checkpoint.get(
            "sizeBytes"
        )

        if (
            not isinstance(
                checkpoint_path,
                str,
            )
            or not checkpoint_path.strip()
        ):
            raise ValueError(
                "Training result checkpoint path "
                "is invalid."
            )

        checkpoint_file = Path(
            checkpoint_path
        )

        if not checkpoint_file.is_file():
            raise ValueError(
                "Training result checkpoint file "
                "does not exist."
            )

        if (
            not isinstance(
                sha256,
                str,
            )
            or len(sha256) != 64
        ):
            raise ValueError(
                "Training result checkpoint "
                "SHA-256 is invalid."
            )

        if (
            isinstance(size_bytes, bool)
            or not isinstance(
                size_bytes,
                int,
            )
            or size_bytes < 0
        ):
            raise ValueError(
                "Training result checkpoint "
                "size is invalid."
            )

        # The artifact storage URI must point to the
        # actual artifact file, not the containing directory.
        #
        # This allows the aggregation worker to load the
        # safetensors file directly.
        storage_uri = str(
            checkpoint_file.resolve()
        )

        result_dict["artifact"] = {
            "jobId": job_id,
            "taskId": task_id,
            "workerId": worker_id,
            "artifactType": "lora_adapter",
            "storageUri": storage_uri,
            "sha256": sha256,
            "sizeBytes": size_bytes,
            "sampleCount": sample_count,
            "modelName": model_name,
            "format": "safetensors",
        }

        return result_dict

    @staticmethod
    def _build_output_directory(
        *,
        job_id: str,
        task_id: str,
        worker_id: str,
    ) -> Path:
        artifact_root = Path(
            settings.artifact_root
        )

        output_directory = (
            artifact_root
            / "jobs"
            / TrainingService._safe_path_component(
                job_id,
                "job_id",
            )
            / "tasks"
            / TrainingService._safe_path_component(
                task_id,
                "task_id",
            )
            / (
                "worker-"
                + TrainingService._safe_path_component(
                    worker_id,
                    "worker_id",
                )
            )
            / "adapter"
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
        if (
            not isinstance(value, str)
            or not value.strip()
        ):
            raise ValueError(
                f"'{field_name}' must be a "
                "non-empty string."
            )

        value = value.strip()

        if value in {".", ".."}:
            raise ValueError(
                f"'{field_name}' contains an "
                "invalid path component."
            )

        if "/" in value or "\\" in value:
            raise ValueError(
                f"'{field_name}' must not contain "
                "path separators."
            )

        return value

    @staticmethod
    def _validate_identity(
        *,
        task_id: str,
        job_id: str,
        worker_id: str,
    ) -> None:
        TrainingService._safe_path_component(
            task_id,
            "task_id",
        )

        TrainingService._safe_path_component(
            job_id,
            "job_id",
        )

        TrainingService._safe_path_component(
            worker_id,
            "worker_id",
        )

    @staticmethod
    def _positive_int(
        value: Any,
        field_name: str,
    ) -> int:
        if (
            isinstance(value, bool)
            or not isinstance(value, int)
            or value <= 0
        ):
            raise ValueError(
                f"'{field_name}' must be a "
                "positive integer."
            )

        return value