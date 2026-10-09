import {
  BlockchainOutboxProcessor,
} from "./blockchain.outbox.processor.js";

const DEFAULT_INTERVAL_MS = 15_000;

export interface BlockchainOutboxWorkerOptions {
  intervalMs?: number;
}

export class BlockchainOutboxWorker {
  private readonly intervalMs: number;

  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private processing = false;

  constructor(
    private readonly processor: BlockchainOutboxProcessor,
    options: BlockchainOutboxWorkerOptions = {},
  ) {
    this.intervalMs =
      options.intervalMs ??
      DEFAULT_INTERVAL_MS;

    if (
      !Number.isInteger(this.intervalMs) ||
      this.intervalMs <= 0
    ) {
      throw new Error(
        "Blockchain outbox worker interval must be a positive integer",
      );
    }
  }

  async start(): Promise<void> {
    if (this.running) {
      return;
    }

    this.running = true;

    /*
     * Process immediately instead of waiting for
     * the first polling interval.
     */
    await this.runCycle();

    if (!this.running) {
      return;
    }

    this.timer = setInterval(() => {
      void this.runCycle();
    }, this.intervalMs);
  }

  async stop(): Promise<void> {
    this.running = false;

    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    /*
     * If a cycle is already running, do not start
     * another one. The current cycle is allowed to
     * finish naturally.
     */
    while (this.processing) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 25);
      });
    }
  }

  private async runCycle(): Promise<void> {
    if (
      !this.running ||
      this.processing
    ) {
      return;
    }

    this.processing = true;

    try {
      await this.processor.processBatch();
    } catch (error) {
      /*
       * A processor failure must not kill the
       * coordinator's event loop.
       *
       * Individual event failures are already
       * handled by BlockchainOutboxProcessor.
       */
      console.error(
        "Blockchain outbox processing cycle failed:",
        error,
      );
    } finally {
      this.processing = false;
    }
  }
}