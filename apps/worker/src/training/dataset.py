from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from datasets import Dataset
from transformers import PreTrainedTokenizerBase


@dataclass(frozen=True)
class TokenizedDataset:
    dataset: Dataset
    tokenizer: PreTrainedTokenizerBase


def build_text_dataset(
    texts: list[str],
) -> Dataset:
    if not texts:
        raise ValueError("Training dataset cannot be empty.")

    normalized = []

    for index, text in enumerate(texts):
        if not isinstance(text, str):
            raise TypeError(
                f"Training sample {index} must be a string."
            )

        value = text.strip()

        if not value:
            raise ValueError(
                f"Training sample {index} cannot be empty."
            )

        normalized.append({"text": value})

    return Dataset.from_list(normalized)


def tokenize_dataset(
    dataset: Dataset,
    tokenizer: PreTrainedTokenizerBase,
    *,
    max_length: int,
) -> Dataset:
    if max_length <= 0:
        raise ValueError(
            "max_length must be greater than zero."
        )

    def tokenize_batch(
        batch: dict[str, list[Any]],
    ) -> dict[str, Any]:
        return tokenizer(
            batch["text"],
            truncation=True,
            max_length=max_length,
            padding=False,
        )

    tokenized = dataset.map(
        tokenize_batch,
        batched=True,
        remove_columns=dataset.column_names,
    )

    if len(tokenized) == 0:
        raise ValueError(
            "Tokenization produced an empty dataset."
        )

    return tokenized