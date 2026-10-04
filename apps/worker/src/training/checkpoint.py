from __future__ import annotations

import hashlib
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable


@dataclass(frozen=True)
class CheckpointArtifact:
    path: str
    sha256: str
    size_bytes: int

    def to_dict(self) -> dict[str, str | int]:
        return {
            "path": self.path,
            "sha256": self.sha256,
            "sizeBytes": self.size_bytes,
        }


def calculate_sha256(
    path: Path,
    *,
    chunk_size: int = 1024 * 1024,
) -> str:
    if not path.is_file():
        raise FileNotFoundError(
            f"Checkpoint file not found: {path}"
        )

    if chunk_size <= 0:
        raise ValueError(
            "chunk_size must be greater than zero."
        )

    digest = hashlib.sha256()

    with path.open("rb") as file:
        while chunk := file.read(chunk_size):
            digest.update(chunk)

    return digest.hexdigest()


def create_checkpoint_artifact(
    path: str | Path,
) -> CheckpointArtifact:
    checkpoint_path = Path(path)

    if not checkpoint_path.is_file():
        raise FileNotFoundError(
            f"Checkpoint file not found: {checkpoint_path}"
        )

    return CheckpointArtifact(
        path=str(checkpoint_path.resolve()),
        sha256=calculate_sha256(checkpoint_path),
        size_bytes=checkpoint_path.stat().st_size,
    )


def find_checkpoint_files(
    directory: str | Path,
) -> list[Path]:
    checkpoint_directory = Path(directory)

    if not checkpoint_directory.is_dir():
        raise NotADirectoryError(
            f"Checkpoint directory not found: "
            f"{checkpoint_directory}"
        )

    return sorted(
        path
        for path in checkpoint_directory.rglob("*")
        if path.is_file()
    )