from __future__ import annotations

import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import torch
from peft import LoraConfig, TaskType, get_peft_model
from transformers import (
    AutoModelForCausalLM,
    AutoTokenizer,
    DataCollatorForLanguageModeling,
    Trainer,
    TrainingArguments,
)

from training.checkpoint import (
    CheckpointArtifact,
    create_checkpoint_artifact,
)
from training.dataset import (
    build_text_dataset,
    tokenize_dataset,
)
from training.metrics import TrainingMetrics


@dataclass(frozen=True)
class TrainingConfig:
    model_name: str
    output_directory: str
    epochs: int = 1
    batch_size: int = 1
    learning_rate: float = 2e-4
    max_length: int = 128

    lora_r: int = 8
    lora_alpha: int = 16
    lora_dropout: float = 0.05

    gradient_accumulation_steps: int = 1

    def validate(self) -> None:
        if not self.model_name.strip():
            raise ValueError(
                "model_name cannot be empty."
            )

        if not self.output_directory.strip():
            raise ValueError(
                "output_directory cannot be empty."
            )

        if self.epochs <= 0:
            raise ValueError(
                "epochs must be greater than zero."
            )

        if self.batch_size <= 0:
            raise ValueError(
                "batch_size must be greater than zero."
            )

        if self.learning_rate <= 0:
            raise ValueError(
                "learning_rate must be greater than zero."
            )

        if self.max_length <= 0:
            raise ValueError(
                "max_length must be greater than zero."
            )

        if self.lora_r <= 0:
            raise ValueError(
                "lora_r must be greater than zero."
            )

        if self.lora_alpha <= 0:
            raise ValueError(
                "lora_alpha must be greater than zero."
            )

        if not 0 <= self.lora_dropout < 1:
            raise ValueError(
                "lora_dropout must be in [0, 1)."
            )

        if self.gradient_accumulation_steps <= 0:
            raise ValueError(
                "gradient_accumulation_steps must "
                "be greater than zero."
            )


@dataclass(frozen=True)
class TrainingResult:
    metrics: TrainingMetrics
    checkpoint: CheckpointArtifact
    device: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "metrics": self.metrics.to_dict(),
            "checkpoint": self.checkpoint.to_dict(),
            "device": self.device,
        }


class LoRATrainer:
    def __init__(
        self,
        config: TrainingConfig,
    ) -> None:
        config.validate()

        self.config = config

    def train(
        self,
        texts: list[str],
    ) -> TrainingResult:
        if not texts:
            raise ValueError(
                "Training dataset cannot be empty."
            )

        output_directory = Path(
            self.config.output_directory
        )
        output_directory.mkdir(
            parents=True,
            exist_ok=True,
        )

        device = (
            "cuda"
            if torch.cuda.is_available()
            else "cpu"
        )

        tokenizer = AutoTokenizer.from_pretrained(
            self.config.model_name,
        )

        if tokenizer.pad_token is None:
            tokenizer.pad_token = tokenizer.eos_token

        base_dataset = build_text_dataset(texts)

        tokenized_dataset = tokenize_dataset(
            base_dataset,
            tokenizer,
            max_length=self.config.max_length,
        )

        model = AutoModelForCausalLM.from_pretrained(
            self.config.model_name,
            torch_dtype=(
                torch.float16
                if device == "cuda"
                else torch.float32
            ),
        )

        if tokenizer.pad_token_id is not None:
            model.config.pad_token_id = (
                tokenizer.pad_token_id
            )

        lora_config = LoraConfig(
            task_type=TaskType.CAUSAL_LM,
            r=self.config.lora_r,
            lora_alpha=self.config.lora_alpha,
            lora_dropout=self.config.lora_dropout,
            bias="none",
        )

        model = get_peft_model(
            model,
            lora_config,
        )

        model.print_trainable_parameters()

        training_arguments = TrainingArguments(
            output_dir=str(output_directory),
            num_train_epochs=self.config.epochs,
            per_device_train_batch_size=(
                self.config.batch_size
            ),
            learning_rate=self.config.learning_rate,
            gradient_accumulation_steps=(
                self.config.gradient_accumulation_steps
            ),
            fp16=device == "cuda",
            bf16=False,
            logging_steps=1,
            save_strategy="epoch",
            report_to=[],
            remove_unused_columns=False,
        )

        data_collator = DataCollatorForLanguageModeling(
            tokenizer=tokenizer,
            mlm=False,
        )

        trainer = Trainer(
            model=model,
            args=training_arguments,
            train_dataset=tokenized_dataset,
            data_collator=data_collator,
        )

        started_at = time.monotonic()

        train_output = trainer.train()

        duration_seconds = (
            time.monotonic() - started_at
        )

        model.save_pretrained(
            output_directory,
            safe_serialization=True,
        )

        tokenizer.save_pretrained(
            output_directory,
        )

        checkpoint_file = (
            output_directory / "adapter_model.safetensors"
        )

        checkpoint = create_checkpoint_artifact(
            checkpoint_file,
        )

        metrics = TrainingMetrics(
            epochs=self.config.epochs,
            samples=len(texts),
            training_loss=float(
                train_output.training_loss
            ),
            duration_seconds=duration_seconds,
        )

        return TrainingResult(
            metrics=metrics,
            checkpoint=checkpoint,
            device=device,
        )