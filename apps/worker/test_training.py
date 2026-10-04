from __future__ import annotations

import tempfile
from pathlib import Path

from training.trainer import (
    LoRATrainer,
    TrainingConfig,
)


def main() -> None:
    with tempfile.TemporaryDirectory(
        prefix="training-test-",
    ) as directory:
        config = TrainingConfig(
            model_name="sshleifer/tiny-gpt2",
            output_directory=directory,
            epochs=1,
            batch_size=1,
            learning_rate=2e-4,
            max_length=64,
            lora_r=4,
            lora_alpha=8,
            lora_dropout=0.05,
        )

        trainer = LoRATrainer(config)

        result = trainer.train(
            [
                "Distributed systems allow "
                "multiple workers to cooperate.",
                "Federated learning trains models "
                "across decentralized workers.",
                "The coordinator schedules training "
                "tasks across workers.",
                "Each worker produces a local model "
                "update.",
            ]
        )

        print("\nTraining completed")
        print("==================")
        print(result.to_dict())

        checkpoint = Path(
            result.checkpoint.path
        )

        assert checkpoint.exists()
        assert checkpoint.name == (
            "adapter_model.safetensors"
        )

        assert len(result.checkpoint.sha256) == 64
        assert result.metrics.samples == 4


if __name__ == "__main__":
    main()