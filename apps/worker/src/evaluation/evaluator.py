from __future__ import annotations

import math
from typing import Sequence

import torch
from transformers import AutoModelForCausalLM, AutoTokenizer

from .types import EvaluationResult


class ModelEvaluator:
    def __init__(
        self,
        model_name: str,
        *,
        max_length: int = 512,
    ) -> None:
        self.model_name = model_name
        self.max_length = max_length

        self.tokenizer = AutoTokenizer.from_pretrained(model_name)

        if self.tokenizer.pad_token is None:
            self.tokenizer.pad_token = self.tokenizer.eos_token

        self.model = AutoModelForCausalLM.from_pretrained(model_name)
        self.model.eval()

        self.device = torch.device(
            "cuda" if torch.cuda.is_available() else "cpu"
        )

        self.model.to(self.device)

    @torch.no_grad()
    def evaluate(
        self,
        dataset: Sequence[str],
    ) -> EvaluationResult:
        if not dataset:
            raise ValueError("Evaluation dataset cannot be empty.")

        total_loss = 0.0
        evaluated_samples = 0

        for sample in dataset:
            if not isinstance(sample, str) or not sample.strip():
                raise ValueError(
                    "Evaluation dataset samples must be non-empty strings."
                )

            encoded = self.tokenizer(
                sample,
                return_tensors="pt",
                truncation=True,
                max_length=self.max_length,
            )

            input_ids = encoded["input_ids"].to(self.device)
            attention_mask = encoded["attention_mask"].to(self.device)

            if input_ids.shape[1] < 2:
                continue

            outputs = self.model(
                input_ids=input_ids,
                attention_mask=attention_mask,
                labels=input_ids,
            )

            if outputs.loss is None:
                raise RuntimeError(
                    f"Model {self.model_name} did not return an evaluation loss."
                )

            loss = float(outputs.loss.detach().cpu().item())

            if not math.isfinite(loss):
                raise RuntimeError(
                    f"Non-finite evaluation loss for model {self.model_name}."
                )

            total_loss += loss
            evaluated_samples += 1

        if evaluated_samples == 0:
            raise ValueError(
                "No valid evaluation samples remained after tokenization."
            )

        average_loss = total_loss / evaluated_samples
        perplexity = math.exp(min(average_loss, 20.0))

        return EvaluationResult(
            model_name=self.model_name,
            sample_count=evaluated_samples,
            average_loss=average_loss,
            perplexity=perplexity,
            metrics={
                "loss": average_loss,
                "perplexity": perplexity,
            },
            metadata={
                "device": str(self.device),
                "maxLength": self.max_length,
            },
        )