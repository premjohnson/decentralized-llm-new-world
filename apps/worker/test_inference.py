from config.settings import settings
from inference.engine import LlamaCppEngine
from inference.service import InferenceService
from inference.types import InferenceRequest


def main() -> None:
    print("Loading model...")

    engine = LlamaCppEngine(
        model_path=settings.model_path,
        n_ctx=settings.context_size,
        n_gpu_layers=settings.gpu_layers,
    )

    service = InferenceService(engine)

    request = InferenceRequest(
        request_id="service-test-001",
        model=settings.model_name,
        prompt="Explain what a distributed LLM inference network is in three sentences.",
        max_tokens=128,
        temperature=0.2,
    )

    response = service.infer(request)

    print("\n=== RESPONSE ===")
    print(response.text)
    print("================")
    print(f"request_id={response.request_id}")
    print(f"model={response.model}")


if __name__ == "__main__":
    main()
