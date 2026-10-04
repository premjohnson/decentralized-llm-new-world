from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class AdapterArtifact:
    """A worker-produced LoRA adapter."""

    path: str
    sample_count: int

    def __post_init__(self) -> None:
        if not self.path.strip():
            raise ValueError("Adapter path cannot be empty.")

        if self.sample_count <= 0:
            raise ValueError(
                "Adapter sample_count must be greater than zero."
            )


@dataclass(frozen=True)
class AggregationResult:
    """Result of a federated adapter aggregation."""

    output_path: str
    sha256: str
    size_bytes: int
    worker_count: int
    total_samples: int

    def to_dict(self) -> dict[str, str | int]:
        return {
            "outputPath": self.output_path,
            "sha256": self.sha256,
            "sizeBytes": self.size_bytes,
            "workerCount": self.worker_count,
            "totalSamples": self.total_samples,
        }