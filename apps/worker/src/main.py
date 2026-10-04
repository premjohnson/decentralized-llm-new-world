from __future__ import annotations

import logging
import platform
import time

from config.settings import settings
from coordinator.client import (
    CoordinatorClient,
    TaskStateConflictError,
    WorkerNotRegisteredError,
)
from hardware.detector import detect_hardware
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
    hardware,
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

    registered = False

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

        while True:

            # --------------------------------------------------
            # Register if necessary
            # --------------------------------------------------

            if not registered:
                logger.info(
                    "Registering worker '%s'...",
                    worker_id,
                )

                registered = register_worker(
                    client=client,
                    worker_id=worker_id,
                    hostname=hostname,
                    hardware=hardware,
                )

                if not registered:
                    logger.warning(
                        "Worker registration failed. "
                        "Retrying in %s seconds.",
                        settings.heartbeat_interval_seconds,
                    )

                    time.sleep(
                        settings.heartbeat_interval_seconds,
                    )

                    continue

            # --------------------------------------------------
            # Heartbeat
            # --------------------------------------------------

            try:
                heartbeat = client.heartbeat_worker(
                    worker_id,
                )

                logger.info(
                    "Heartbeat sent | status=%s",
                    heartbeat["data"]["status"],
                )

            except WorkerNotRegisteredError:
                logger.warning(
                    "Coordinator no longer knows worker '%s'. "
                    "Re-registration required.",
                    worker_id,
                )

                registered = False

                continue

            except Exception as error:
                logger.error(
                    "Heartbeat failed: %s",
                    error,
                )

            # --------------------------------------------------
            # Claim and execute work
            # --------------------------------------------------

            if registered:
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

                    registered = False

                except Exception as error:
                    logger.exception(
                        "Unexpected task processing error: %s",
                        error,
                    )

            # --------------------------------------------------
            # Wait before next cycle
            # --------------------------------------------------

            time.sleep(
                settings.heartbeat_interval_seconds,
            )

    except KeyboardInterrupt:
        logger.info(
            "Worker shutdown requested",
        )

    finally:
        client.close()

        logger.info(
            "Worker stopped",
        )


if __name__ == "__main__":
    main()