from __future__ import annotations

import uvicorn

from config.settings import settings


def main() -> None:
    uvicorn.run(
        "api.app:app",
        host=settings.worker_host,
        port=settings.worker_port,
        reload=False,
    )


if __name__ == "__main__":
    main()
