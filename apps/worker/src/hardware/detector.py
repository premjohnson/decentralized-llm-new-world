from __future__ import annotations

import platform
import shutil
import subprocess
from dataclasses import asdict, dataclass

import psutil


@dataclass(frozen=True)
class GPUInfo:
    available: bool
    name: str | None = None
    vram_mb: int | None = None
    driver_version: str | None = None
    cuda_version: str | None = None


@dataclass(frozen=True)
class HardwareInfo:
    cpu_cores: int
    memory_mb: int
    operating_system: str
    architecture: str
    gpu: GPUInfo


def detect_nvidia_gpu() -> GPUInfo:
    if shutil.which("nvidia-smi") is None:
        return GPUInfo(available=False)

    command = [
        "nvidia-smi",
        "--query-gpu=name,memory.total,driver_version",
        "--format=csv,noheader,nounits",
    ]

    try:
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            check=True,
            timeout=5,
        )

        line = result.stdout.strip().splitlines()[0]

        name, memory_mb, driver_version = [
            value.strip() for value in line.split(",")
        ]

        return GPUInfo(
            available=True,
            name=name,
            vram_mb=int(float(memory_mb)),
            driver_version=driver_version,
            cuda_version=detect_cuda_version(),
        )

    except (
        subprocess.SubprocessError,
        ValueError,
        IndexError,
    ):
        return GPUInfo(available=False)


def detect_cuda_version() -> str | None:
    try:
        result = subprocess.run(
            ["nvidia-smi"],
            capture_output=True,
            text=True,
            check=True,
            timeout=5,
        )

        for line in result.stdout.splitlines():
            if "CUDA Version:" in line:
                return line.split("CUDA Version:", 1)[1].split()[0]

    except (subprocess.SubprocessError, IndexError):
        pass

    return None


def detect_hardware() -> HardwareInfo:
    return HardwareInfo(
        cpu_cores=psutil.cpu_count(logical=True) or 1,
        memory_mb=int(psutil.virtual_memory().total / (1024 * 1024)),
        operating_system=platform.system(),
        architecture=platform.machine(),
        gpu=detect_nvidia_gpu(),
    )


def hardware_to_dict(info: HardwareInfo) -> dict:
    return asdict(info)