from __future__ import annotations

from typing import Any

import httpx

from hardware.detector import HardwareInfo


class CoordinatorError(Exception):
    """Base exception for coordinator communication errors."""


class WorkerNotRegisteredError(CoordinatorError):
    """Raised when the coordinator no longer knows this worker."""


class NoTaskAvailableError(CoordinatorError):
    """Raised when there are currently no pending tasks."""


class TaskStateConflictError(CoordinatorError):
    """Raised when a task cannot transition to the requested state."""


class CoordinatorClient:
    def __init__(self, base_url: str) -> None:
        self.base_url = base_url.rstrip("/")

        self.client = httpx.Client(
            timeout=httpx.Timeout(
                connect=5.0,
                read=30.0,
                write=30.0,
                pool=5.0,
            ),
        )

    def register_worker(
        self,
        worker_id: str,
        hostname: str,
        hardware: HardwareInfo,
    ) -> dict[str, Any]:
        gpu = hardware.gpu

        payload = {
            "workerId": worker_id,
            "hostname": hostname,
            "capabilities": {
                "cpuCores": hardware.cpu_cores,
                "memoryMb": hardware.memory_mb,
                "gpu": gpu.available,
                "gpuModel": gpu.name,
                "vramMb": gpu.vram_mb,
            },
        }

        response = self.client.post(
            f"{self.base_url}/api/v1/workers/register",
            json=payload,
        )

        response.raise_for_status()

        return response.json()

    def heartbeat_worker(
        self,
        worker_id: str,
    ) -> dict[str, Any]:
        response = self.client.post(
            f"{self.base_url}/api/v1/workers/{worker_id}/heartbeat",
        )

        if response.status_code == 404:
            raise WorkerNotRegisteredError(
                f"Worker '{worker_id}' is not registered "
                "with the coordinator."
            )

        response.raise_for_status()

        return response.json()

    def claim_task(
        self,
        worker_id: str,
    ) -> dict[str, Any] | None:
        response = self.client.post(
            f"{self.base_url}/api/v1/tasks/claim",
            json={
                "workerId": worker_id,
            },
        )

        if response.status_code == 204:
            return None

        if response.status_code == 404:
            raise WorkerNotRegisteredError(
                f"Worker '{worker_id}' is not registered "
                "with the coordinator."
            )

        response.raise_for_status()

        return response.json()

    def mark_task_running(
        self,
        task_id: str,
        worker_id: str,
    ) -> dict[str, Any]:
        response = self.client.post(
            f"{self.base_url}/api/v1/tasks/"
            f"{task_id}/running/{worker_id}",
        )

        if response.status_code == 409:
            raise TaskStateConflictError(
                f"Task '{task_id}' cannot be moved "
                "to running state."
            )

        response.raise_for_status()

        return response.json()

    def complete_task(
        self,
        task_id: str,
        worker_id: str,
        result: dict[str, Any],
    ) -> dict[str, Any]:
        response = self.client.post(
            f"{self.base_url}/api/v1/tasks/"
            f"{task_id}/complete/{worker_id}",
            json={
                "result": result,
            },
        )

        if response.status_code == 409:
            raise TaskStateConflictError(
                f"Task '{task_id}' cannot be completed "
                "from its current state."
            )

        response.raise_for_status()

        return response.json()

    def fail_task(
        self,
        task_id: str,
        worker_id: str,
        error_message: str,
    ) -> dict[str, Any]:
        response = self.client.post(
            f"{self.base_url}/api/v1/tasks/"
            f"{task_id}/fail/{worker_id}",
            json={
                "errorMessage": error_message,
            },
        )

        if response.status_code == 409:
            raise TaskStateConflictError(
                f"Task '{task_id}' cannot be failed "
                "from its current state."
            )

        response.raise_for_status()

        return response.json()

    def close(self) -> None:
        self.client.close()