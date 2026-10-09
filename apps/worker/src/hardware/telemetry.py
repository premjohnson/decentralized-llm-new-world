from __future__ import annotations

import shutil
import subprocess
from datetime import datetime, timezone
from typing import Any

import psutil


def collect_telemetry() -> dict[str, Any]:
    memory = psutil.virtual_memory()

    # Prime CPU measurement, then take a short interval sample.
    cpu_percent = psutil.cpu_percent(interval=0.2)

    gpu_utilization: float | None = None
    gpu_memory_used: int | None = None
    gpu_memory_total: int | None = None

    if shutil.which("nvidia-smi"):
        try:
            result = subprocess.run(
                [
                    "nvidia-smi",
                    "--query-gpu=utilization.gpu,memory.used,memory.total",
                    "--format=csv,noheader,nounits",
                ],
                capture_output=True,
                text=True,
                check=True,
                timeout=3,
            )

            # Use the first NVIDIA GPU reported by nvidia-smi.
            values = [
                value.strip()
                for value in result.stdout.strip().splitlines()[0].split(",")
            ]

            if len(values) == 3:
                gpu_utilization = float(values[0])
                gpu_memory_used = int(float(values[1]))
                gpu_memory_total = int(float(values[2]))

        except (
            subprocess.SubprocessError,
            ValueError,
            IndexError,
        ):
            # GPU metrics remain unknown if sampling fails.
            pass

    return {
        "cpuUsagePercent": cpu_percent,
        "memoryUsedMb": int(memory.used / (1024 * 1024)),
        "memoryTotalMb": int(memory.total / (1024 * 1024)),
        "gpuUtilizationPercent": gpu_utilization,
        "gpuMemoryUsedMb": gpu_memory_used,
        "gpuMemoryTotalMb": gpu_memory_total,
        "collectedAt": datetime.now(timezone.utc).isoformat(),
    }
