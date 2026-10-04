from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class EvaluationResult:
    model_name: str
    sample_count: int
    average_loss: float
    perplexity: float
    metrics: dict[str, float]
    metadata: dict[str, Any]