from __future__ import annotations

from pathlib import Path

import torch
from safetensors.torch import load_file, save_file

from aggregation.fedavg import FedAvgAggregator
from aggregation.types import AdapterArtifact


def create_adapter(
    path: Path,
    value: float,
) -> None:
    tensors = {
        "lora_A.weight": torch.full(
            (2, 2),
            value,
            dtype=torch.float32,
        ),
        "lora_B.weight": torch.full(
            (2, 2),
            value * 2,
            dtype=torch.float32,
        ),
    }

    save_file(tensors, str(path))


def test_fedavg_single_adapter(tmp_path: Path) -> None:
    adapter_path = tmp_path / "adapter-a.safetensors"
    output_path = tmp_path / "global.safetensors"

    create_adapter(adapter_path, 2.0)

    aggregator = FedAvgAggregator()

    result = aggregator.aggregate(
        [
            AdapterArtifact(
                path=str(adapter_path),
                sample_count=10,
            )
        ],
        output_path,
    )

    assert result.worker_count == 1
    assert result.total_samples == 10
    assert result.size_bytes > 0
    assert len(result.sha256) == 64
    assert output_path.exists()

    global_state = load_file(str(output_path))

    assert torch.allclose(
        global_state["lora_A.weight"],
        torch.full((2, 2), 2.0),
    )

    assert torch.allclose(
        global_state["lora_B.weight"],
        torch.full((2, 2), 4.0),
    )


def test_fedavg_weighted_average(tmp_path: Path) -> None:
    adapter_a = tmp_path / "adapter-a.safetensors"
    adapter_b = tmp_path / "adapter-b.safetensors"
    output_path = tmp_path / "global.safetensors"

    create_adapter(adapter_a, 2.0)
    create_adapter(adapter_b, 6.0)

    aggregator = FedAvgAggregator()

    result = aggregator.aggregate(
        [
            AdapterArtifact(
                path=str(adapter_a),
                sample_count=1,
            ),
            AdapterArtifact(
                path=str(adapter_b),
                sample_count=3,
            ),
        ],
        output_path,
    )

    assert result.worker_count == 2
    assert result.total_samples == 4

    global_state = load_file(str(output_path))

    # (2 * 1/4) + (6 * 3/4) = 5
    assert torch.allclose(
        global_state["lora_A.weight"],
        torch.full((2, 2), 5.0),
    )

    # B weights are value * 2:
    # (4 * 1/4) + (12 * 3/4) = 10
    assert torch.allclose(
        global_state["lora_B.weight"],
        torch.full((2, 2), 10.0),
    )


def test_fedavg_rejects_incompatible_keys(
    tmp_path: Path,
) -> None:
    adapter_a = tmp_path / "adapter-a.safetensors"
    adapter_b = tmp_path / "adapter-b.safetensors"
    output_path = tmp_path / "global.safetensors"

    save_file(
        {
            "lora_A.weight": torch.ones(
                (2, 2),
                dtype=torch.float32,
            ),
        },
        str(adapter_a),
    )

    save_file(
        {
            "different.weight": torch.ones(
                (2, 2),
                dtype=torch.float32,
            ),
        },
        str(adapter_b),
    )

    aggregator = FedAvgAggregator()

    try:
        aggregator.aggregate(
            [
                AdapterArtifact(
                    path=str(adapter_a),
                    sample_count=1,
                ),
                AdapterArtifact(
                    path=str(adapter_b),
                    sample_count=1,
                ),
            ],
            output_path,
        )
    except ValueError as error:
        assert "incompatible" in str(error)
    else:
        raise AssertionError(
            "Expected incompatible adapters to be rejected."
        )


def test_fedavg_rejects_empty_artifacts(
    tmp_path: Path,
) -> None:
    aggregator = FedAvgAggregator()

    try:
        aggregator.aggregate(
            [],
            tmp_path / "global.safetensors",
        )
    except ValueError as error:
        assert "At least one adapter" in str(error)
    else:
        raise AssertionError(
            "Expected empty artifact list to be rejected."
        )