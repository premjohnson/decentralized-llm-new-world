from __future__ import annotations

from pathlib import Path

import torch
from safetensors.torch import load_file, save_file

from aggregation.types import (
    AdapterArtifact,
    AggregationResult,
)
from training.checkpoint import calculate_sha256


class FedAvgAggregator:
    """Weighted FedAvg aggregator for LoRA adapter tensors."""

    def aggregate(
        self,
        artifacts: list[AdapterArtifact],
        output_path: str | Path,
    ) -> AggregationResult:
        if not artifacts:
            raise ValueError(
                "At least one adapter is required for aggregation."
            )

        output = Path(output_path)
        output.parent.mkdir(
            parents=True,
            exist_ok=True,
        )

        total_samples = sum(
            artifact.sample_count
            for artifact in artifacts
        )

        if total_samples <= 0:
            raise ValueError(
                "Total sample count must be greater than zero."
            )

        state_dicts = [
            load_file(artifact.path)
            for artifact in artifacts
        ]

        self._validate_compatible_state_dicts(
            state_dicts
        )

        global_state = self._weighted_average(
            state_dicts=state_dicts,
            artifacts=artifacts,
            total_samples=total_samples,
        )

        save_file(
            global_state,
            str(output),
        )

        return AggregationResult(
            output_path=str(output.resolve()),
            sha256=calculate_sha256(output),
            size_bytes=output.stat().st_size,
            worker_count=len(artifacts),
            total_samples=total_samples,
        )

    @staticmethod
    def _validate_compatible_state_dicts(
        state_dicts: list[dict[str, torch.Tensor]],
    ) -> None:
        if not state_dicts:
            raise ValueError(
                "No adapter state dictionaries provided."
            )

        reference_keys = set(state_dicts[0].keys())

        for index, state_dict in enumerate(state_dicts[1:], start=2):
            keys = set(state_dict.keys())

            if keys != reference_keys:
                missing = reference_keys - keys
                extra = keys - reference_keys

                raise ValueError(
                    "Adapter state dictionaries are incompatible "
                    f"for worker index {index}. "
                    f"Missing keys: {sorted(missing)}. "
                    f"Extra keys: {sorted(extra)}."
                )

        for key in reference_keys:
            reference_shape = state_dicts[0][key].shape

            for index, state_dict in enumerate(
                state_dicts[1:],
                start=2,
            ):
                if state_dict[key].shape != reference_shape:
                    raise ValueError(
                        f"Tensor shape mismatch for '{key}' "
                        f"at worker index {index}: "
                        f"expected {reference_shape}, "
                        f"got {state_dict[key].shape}."
                    )

    @staticmethod
    def _weighted_average(
        state_dicts: list[dict[str, torch.Tensor]],
        artifacts: list[AdapterArtifact],
        total_samples: int,
    ) -> dict[str, torch.Tensor]:
        result: dict[str, torch.Tensor] = {}

        reference = state_dicts[0]

        for key in reference:
            accumulator = torch.zeros_like(
                reference[key],
                dtype=torch.float32,
            )

            for state_dict, artifact in zip(
                state_dicts,
                artifacts,
                strict=True,
            ):
                weight = (
                    artifact.sample_count
                    / total_samples
                )

                accumulator += (
                    state_dict[key].float()
                    * weight
                )

            result[key] = accumulator.to(
                dtype=reference[key].dtype
            )

        return result