from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    worker_id: str = "worker-01"
    coordinator_url: str = "http://localhost:4000"
    heartbeat_interval_seconds: int = 15

    # Worker API
    worker_host: str = "0.0.0.0"
    worker_port: int = 8000

    # Inference configuration
    model_name: str = "qwen2.5-1.5b-instruct-q4_k_m"
    model_path: str = "models/qwen2.5-1.5b-instruct-q4_k_m.gguf"
    context_size: int = 2048
    gpu_layers: int = -1

    model_config = SettingsConfigDict(
        env_prefix="WORKER_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = Settings()