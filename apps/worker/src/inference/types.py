from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class InferenceRequest:
    request_id: str
    model: str
    prompt: str
    max_tokens: int = 256
    temperature: float = 0.7


@dataclass(frozen=True)
class InferenceResponse:
    request_id: str
    model: str
    text: str