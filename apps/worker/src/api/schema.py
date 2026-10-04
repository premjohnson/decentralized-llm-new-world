from __future__ import annotations

from pydantic import BaseModel, Field


class InferenceRequestBody(BaseModel):
    request_id: str = Field(min_length=1, max_length=100)
    model: str = Field(min_length=1, max_length=200)
    prompt: str = Field(min_length=1)
    max_tokens: int = Field(default=256, ge=1, le=4096)
    temperature: float = Field(default=0.7, ge=0.0, le=2.0)


class InferenceResponseBody(BaseModel):
    request_id: str
    model: str
    text: str
