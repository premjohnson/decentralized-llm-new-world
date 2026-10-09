from __future__ import annotations

import logging
import platform
import threading
from typing import Any

from config.settings import settings
from coordinator.client import (
    CoordinatorClient,
    TaskStateConflictError,
    WorkerNotRegisteredError,
)
from hardware.detector import detect_hardware
from hardware.telemetry import collect_telemetry
from tasks.executor import (
    TaskExecutor,
    UnsupportedTaskError,
)


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(message)s",
)

logger = logging.getLogger(__name__)


def register_worker(
    client: CoordinatorClient,
    worker_id: str,
    hostname: str,
    hardware: Any,
) -> bool:
    try:
        registration = client.register_worker(
            worker_id=worker_id,
            hostname=hostname,
            hardware=hardware,
        )

        logger.info(
            "Worker registered successfully: %s",
            registration["data"]["workerId"],
        )

        return True

    except Exception as error:
        logger.error(
            "Worker registration failed: %s",
            error,
        )
        return False


def process_one_task(
    client: CoordinatorClient,
    executor: TaskExecutor,
    worker_id: str,
) -> None:
    task = client.claim_task(worker_id)

    if task is None:
        return

    task_id = task["taskId"]
    task_type = task["taskType"]

    logger.info(
        "Task claimed | taskId=%s | type=%s | attempt=%s",
        task_id,
        task_type,
        task.get("attempt"),
    )

    try:
        client.mark_task_running(
            task_id=task_id,
            worker_id=worker_id,
        )

        logger.info(
            "Task running | taskId=%s",
            task_id,
        )

        result = executor.execute(task)

        logger.info(
            "Task execution completed | taskId=%s",
            task_id,
        )

        logger.debug(
            "Task result | taskId=%s | result=%s",
            task_id,
            result,
        )

        completed = client.complete_task(
            task_id=task_id,
            worker_id=worker_id,
            result=result,
        )

        logger.info(
            "Task completed | taskId=%s | status=%s",
            task_id,
            completed.get("status"),
        )

    except UnsupportedTaskError as error:
        logger.error(
            "Unsupported task | taskId=%s | error=%s",
            task_id,
            error,
        )

        try:
            client.fail_task(
                task_id=task_id,
                worker_id=worker_id,
                error_message=str(error),
            )

        except Exception as fail_error:
            logger.error(
                "Failed to report task failure | "
                "taskId=%s | error=%s",
                task_id,
                fail_error,
            )

    except TaskStateConflictError as error:
        logger.error(
            "Task state transition failed | "
            "taskId=%s | error=%s",
            task_id,
            error,
        )

    except WorkerNotRegisteredError:
        raise

    except Exception as error:
        logger.exception(
            "Task execution failed | taskId=%s",
            task_id,
        )

        try:
            failed = client.fail_task(
                task_id=task_id,
                worker_id=worker_id,
                error_message=str(error),
            )

            logger.info(
                "Task failure reported | "
                "taskId=%s | status=%s",
                task_id,
                failed.get("status"),
            )

        except Exception as fail_error:
            logger.error(
                "Failed to report task failure | "
                "taskId=%s | error=%s",
                task_id,
                fail_error,
            )


def heartbeat_loop(
    client: CoordinatorClient,
    worker_id: str,
    hostname: str,
    hardware: Any,
    registered: threading.Event,
    stop_event: threading.Event,
) -> None:
    """
    Keep heartbeats independent from task execution.

    Re-register when the Coordinator no longer recognizes this worker.
    Telemetry failures must not interrupt heartbeat recovery.
    """

    interval = settings.heartbeat_interval_seconds

    while not stop_event.is_set():
        if not registered.is_set():
            logger.info(
                "Heartbeat loop attempting worker registration..."
            )

            success = register_worker(
                client=client,
                worker_id=worker_id,
                hostname=hostname,
                hardware=hardware,
            )

            if success:
                registered.set()

                logger.info(
                    "Worker re-registered successfully."
                )
            else:
                logger.warning(
                    "Worker registration failed. "
                    "Retrying in %s seconds.",
                    interval,
                )

                stop_event.wait(interval)
                continue

        try:
            heartbeat = client.heartbeat_worker(worker_id)

            logger.info(
                "Heartbeat sent | status=%s",
                heartbeat["data"]["status"],
            )

            # Telemetry is independent of heartbeat recovery.
            try:
                telemetry = collect_telemetry()

                client.report_telemetry(
                    worker_id=worker_id,
                    telemetry=telemetry,
                )

                logger.debug(
                    "Worker telemetry reported successfully."
                )

            except Exception as telemetry_error:
                logger.warning(
                    "Telemetry reporting failed: %s",
                    telemetry_error,
                )

        except WorkerNotRegisteredError:
            logger.warning(
                "Coordinator no longer knows worker '%s'. "
                "Re-registration required.",
                worker_id,
            )

            registered.clear()

        except Exception as error:
            logger.error(
                "Heartbeat failed: %s",
                error,
            )

        stop_event.wait(interval)


def main() -> None:
    hardware = detect_hardware()
    hostname = platform.node()
    worker_id = settings.worker_id

    logger.info("Worker hardware detected")

    logger.info(
        "CPU cores: %s",
        hardware.cpu_cores,
    )

    logger.info(
        "Memory: %s MB",
        hardware.memory_mb,
    )

    logger.info(
        "GPU available: %s",
        hardware.gpu.available,
    )

    client = CoordinatorClient(
        settings.coordinator_url,
    )

    executor = TaskExecutor(
        model_path=settings.model_path,
        context_size=settings.context_size,
        gpu_layers=settings.gpu_layers,
        model_name=settings.model_name,
    )

    registered = threading.Event()
    stop_event = threading.Event()

    heartbeat_thread: threading.Thread | None = None

    try:
        logger.info(
            "Worker ID: %s",
            worker_id,
        )

        logger.info(
            "Coordinator: %s",
            settings.coordinator_url,
        )

        logger.info(
            "Heartbeat interval: %s seconds",
            settings.heartbeat_interval_seconds,
        )

        # Initial registration.
        while not registered.is_set():
            if stop_event.is_set():
                return

            logger.info(
                "Registering worker '%s'...",
                worker_id,
            )

            if register_worker(
                client=client,
                worker_id=worker_id,
                hostname=hostname,
                hardware=hardware,
            ):
                registered.set()
                break

            logger.warning(
                "Worker registration failed. "
                "Retrying in %s seconds.",
                settings.heartbeat_interval_seconds,
            )

            stop_event.wait(
                settings.heartbeat_interval_seconds,
            )

        # Start the independent heartbeat and telemetry loop.
        heartbeat_thread = threading.Thread(
            target=heartbeat_loop,
            args=(
                client,
                worker_id,
                hostname,
                hardware,
                registered,
                stop_event,
            ),
            name="worker-heartbeat",
            daemon=True,
        )

        heartbeat_thread.start()

        logger.info(
            "Worker heartbeat thread started."
        )

        # Main task-processing loop.
        while not stop_event.is_set():
            if not registered.is_set():
                stop_event.wait(
                    settings.heartbeat_interval_seconds,
                )
                continue

            try:
                process_one_task(
                    client=client,
                    executor=executor,
                    worker_id=worker_id,
                )

            except WorkerNotRegisteredError:
                logger.warning(
                    "Worker '%s' is no longer registered.",
                    worker_id,
                )

                registered.clear()

            except Exception as error:
                logger.exception(
                    "Unexpected task processing error: %s",
                    error,
                )

            # Avoid busy-looping when there is no task.
            stop_event.wait(
                settings.heartbeat_interval_seconds,
            )

    except KeyboardInterrupt:
        logger.info("Worker shutdown requested.")

    finally:
        stop_event.set()

        if heartbeat_thread is not None:
            heartbeat_thread.join(
                timeout=settings.heartbeat_interval_seconds + 1,
            )

        client.close()

        logger.info("Worker stopped.")


if __name__ == "__main__":
    main()
