from __future__ import annotations

from dataclasses import asdict, dataclass


@dataclass(frozen=True)
class TrainingMetrics:
    epochs: int
    samples: int
    training_loss: float
    duration_seconds: float

    def to_dict(self) -> dict[str, float | int]:
        return asdict(self)