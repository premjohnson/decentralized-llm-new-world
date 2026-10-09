import {
  AnchorProvider,
  Program,
  Wallet,
} from "@coral-xyz/anchor";

import BN from "bn.js";

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";

import { readFileSync } from "node:fs";

import idl from "./idl/blockchain_training_registry.json" with {
  type: "json",
};

import { hashJobId } from "./blockchain.crypto.js";

import type {
  BlockchainTrainingStatus,
  RecordTrainingRoundInput,
  RegisterTrainingJobInput,
  UpdateTrainingStatusInput,
} from "./blockchain.types.js";

const PROGRAM_ID = new PublicKey(
  "AqSVCKJqFTNmnRofWKPSvBxVMXtNohn9i1dXhHCCUskT",
);

const SYSTEM_PROGRAM_ID = SystemProgram.programId;

/**
 * Anchor dynamically generates the Program API from the IDL.
 *
 * The generated JSON IDL does not expose enough static information
 * for TypeScript to infer the complete Program type safely.
 *
 * Therefore, the untyped boundary is intentionally isolated inside
 * this blockchain adapter.
 */
type AnchorProgram = any;

type TrainingJobStatus =
  | {
      registered: Record<string, never>;
    }
  | {
      running: Record<string, never>;
    }
  | {
      completed: Record<string, never>;
    }
  | {
      failed: Record<string, never>;
    };

interface TrainingJobAccount {
  jobIdHash: number[] | Uint8Array;
  modelName: string;
  modelVersion: string;
  workerCount: number;
  datasetHash: number[] | Uint8Array;
  status: TrainingJobStatus;
  createdAt: BN;
  updatedAt: BN;
  roundCount: BN;
}

export class BlockchainClient {
  private readonly connection: Connection;
  private readonly provider: AnchorProvider;
  private readonly program: AnchorProgram;

  constructor(
    rpcUrl: string,
    walletPath: string,
  ) {
    if (!rpcUrl.trim()) {
      throw new Error(
        "Blockchain RPC URL must not be empty",
      );
    }

    if (!walletPath.trim()) {
      throw new Error(
        "Blockchain wallet path must not be empty",
      );
    }

    const rawSecretKey = readFileSync(
      walletPath,
      "utf8",
    );

    const parsedSecretKey: unknown =
      JSON.parse(rawSecretKey);

    if (
      !Array.isArray(parsedSecretKey) ||
      parsedSecretKey.length !== 64 ||
      !parsedSecretKey.every(
        (value) =>
          Number.isInteger(value) &&
          value >= 0 &&
          value <= 255,
      )
    ) {
      throw new Error(
        "Blockchain wallet must contain a valid 64-byte Solana secret key",
      );
    }

    const secretKey = Uint8Array.from(
      parsedSecretKey as number[],
    );

    const keypair =
      Keypair.fromSecretKey(secretKey);

    const wallet =
      new Wallet(keypair);

    this.connection =
      new Connection(
        rpcUrl,
        "confirmed",
      );

    this.provider =
      new AnchorProvider(
        this.connection,
        wallet,
        {
          commitment: "confirmed",
        },
      );

    /**
     * Anchor dynamically creates the methods and account
     * namespaces from the supplied IDL.
     *
     * Keep this cast isolated here.
     */
    this.program =
      new Program(
        idl as any,
        this.provider,
      ) as any;
  }

  /**
   * Returns the deployed Solana program ID.
   */
  get programId(): PublicKey {
    return PROGRAM_ID;
  }

  /**
   * Returns the wallet used by the Coordinator
   * to sign blockchain transactions.
   */
  get authority(): PublicKey {
    return this.provider.wallet.publicKey;
  }

  /**
   * Derive the TrainingJob PDA.
   *
   * Seeds:
   *
   * ["training_job", jobIdHash]
   */
  getTrainingJobPda(
    jobIdHash: Uint8Array,
  ): PublicKey {
    if (jobIdHash.length !== 32) {
      throw new Error(
        "jobIdHash must contain exactly 32 bytes",
      );
    }

    const [trainingJob] =
      PublicKey.findProgramAddressSync(
        [
          Buffer.from("training_job"),
          Buffer.from(jobIdHash),
        ],
        PROGRAM_ID,
      );

    return trainingJob;
  }

  /**
   * Derive the TrainingRound PDA.
   *
   * Seeds:
   *
   * ["training_round", trainingJob, roundNumber]
   *
   * roundNumber is encoded as little-endian u64.
   */
  getTrainingRoundPda(
    trainingJob: PublicKey,
    roundNumber: number,
  ): PublicKey {
    if (
      !Number.isSafeInteger(roundNumber) ||
      roundNumber <= 0
    ) {
      throw new Error(
        "roundNumber must be a positive safe integer",
      );
    }

    const roundNumberBuffer =
      Buffer.alloc(8);

    roundNumberBuffer.writeBigUInt64LE(
      BigInt(roundNumber),
    );

    const [trainingRound] =
      PublicKey.findProgramAddressSync(
        [
          Buffer.from("training_round"),
          trainingJob.toBuffer(),
          roundNumberBuffer,
        ],
        PROGRAM_ID,
      );

    return trainingRound;
  }

  /**
   * Get the Coordinator wallet SOL balance.
   */
  async getBalance(): Promise<number> {
    const lamports =
      await this.connection.getBalance(
        this.authority,
      );

    return (
      lamports / 1_000_000_000
    );
  }

  /**
   * Fetch a TrainingJob account from Solana.
   *
   * Returns null when the account does not exist.
   */
  async getTrainingJob(
    jobId: string,
  ): Promise<{
    address: string;
    jobIdHash: number[];
    modelName: string;
    modelVersion: string;
    workerCount: number;
    datasetHash: number[];
    status: TrainingJobStatus;
    createdAt: BN;
    updatedAt: BN;
    roundCount: BN;
  } | null> {
    if (!jobId.trim()) {
      throw new Error(
        "jobId must not be empty",
      );
    }

    const jobIdHash =
      hashJobId(jobId);

    const trainingJob =
      this.getTrainingJobPda(
        jobIdHash,
      );

    const account =
      (await this.program.account.trainingJob.fetchNullable(
        trainingJob,
      )) as TrainingJobAccount | null;

    if (!account) {
      return null;
    }

    return {
      address:
        trainingJob.toBase58(),

      jobIdHash:
        Array.from(account.jobIdHash),

      modelName:
        account.modelName,

      modelVersion:
        account.modelVersion,

      workerCount:
        account.workerCount,

      datasetHash:
        Array.from(account.datasetHash),

      status:
        account.status,

      createdAt:
        account.createdAt,

      updatedAt:
        account.updatedAt,

      roundCount:
        account.roundCount,
    };
  }

  /**
   * Register a new training job on-chain.
   *
   * Coordinator UUID
   *        ↓
   * SHA-256
   *        ↓
   * jobIdHash [32 bytes]
   *        ↓
   * TrainingJob PDA
   */
  async registerTrainingJob(
    input: RegisterTrainingJobInput,
  ): Promise<{
    signature: string;
    trainingJobAddress: string;
  }> {
    if (!input.jobId.trim()) {
      throw new Error(
        "jobId must not be empty",
      );
    }

    if (!input.modelName.trim()) {
      throw new Error(
        "modelName must not be empty",
      );
    }

    if (!input.modelVersion.trim()) {
      throw new Error(
        "modelVersion must not be empty",
      );
    }

    if (input.datasetHash.length !== 32) {
      throw new Error(
        "datasetHash must contain exactly 32 bytes",
      );
    }

    if (
      !Number.isSafeInteger(
        input.workerCount,
      ) ||
      input.workerCount <= 0 ||
      input.workerCount > 65_535
    ) {
      throw new Error(
        "workerCount must be an integer between 1 and 65535",
      );
    }

    const jobIdHash =
      hashJobId(input.jobId);

    const trainingJob =
      this.getTrainingJobPda(
        jobIdHash,
      );

    const signature =
      await this.program.methods
        .registerTrainingJob(
          Array.from(jobIdHash),
          input.modelName,
          input.modelVersion,
          input.workerCount,
          Array.from(input.datasetHash),
        )
        .accounts({
          trainingJob,
          authority:
            this.authority,
          systemProgram:
            SYSTEM_PROGRAM_ID,
        })
        .rpc();

    return {
      signature,
      trainingJobAddress:
        trainingJob.toBase58(),
    };
  }

  /**
   * Update the training status on-chain.
   */
  async updateTrainingStatus(
    input: UpdateTrainingStatusInput,
  ): Promise<{
    signature: string;
    trainingJobAddress: string;
  }> {
    if (!input.jobId.trim()) {
      throw new Error(
        "jobId must not be empty",
      );
    }

    const jobIdHash =
      hashJobId(input.jobId);

    const trainingJob =
      this.getTrainingJobPda(
        jobIdHash,
      );

    const statusMap: Record<
      BlockchainTrainingStatus,
      TrainingJobStatus
    > = {
      registered: {
        registered: {},
      },

      running: {
        running: {},
      },

      completed: {
        completed: {},
      },

      failed: {
        failed: {},
      },
    };

    const status =
      statusMap[input.status];

    const signature =
      await this.program.methods
        .updateTrainingStatus(
          status,
        )
        .accounts({
          trainingJob,
          authority:
            this.authority,
        })
        .rpc();

    return {
      signature,
      trainingJobAddress:
        trainingJob.toBase58(),
    };
  }

  /**
   * Record a training round on-chain.
   *
   * TrainingRound PDA:
   *
   * ["training_round", trainingJob, roundNumber]
   */
  async recordTrainingRound(
    input: RecordTrainingRoundInput,
  ): Promise<{
    signature: string;
    trainingJobAddress: string;
    trainingRoundAddress: string;
  }> {
    if (!input.jobId.trim()) {
      throw new Error(
        "jobId must not be empty",
      );
    }

    if (
      !Number.isSafeInteger(
        input.roundNumber,
      ) ||
      input.roundNumber <= 0
    ) {
      throw new Error(
        "roundNumber must be a positive safe integer",
      );
    }

    if (
      input.checkpointHash.length !== 32
    ) {
      throw new Error(
        "checkpointHash must contain exactly 32 bytes",
      );
    }

    if (
      input.artifactHash.length !== 32
    ) {
      throw new Error(
        "artifactHash must contain exactly 32 bytes",
      );
    }

    if (
      input.aggregationHash.length !== 32
    ) {
      throw new Error(
        "aggregationHash must contain exactly 32 bytes",
      );
    }

    const jobIdHash =
      hashJobId(input.jobId);

    const trainingJob =
      this.getTrainingJobPda(
        jobIdHash,
      );

    const trainingRound =
      this.getTrainingRoundPda(
        trainingJob,
        input.roundNumber,
      );

    const signature =
      await this.program.methods
        .recordTrainingRound(
          new BN(
            input.roundNumber,
          ),
          Array.from(
            input.checkpointHash,
          ),
          Array.from(
            input.artifactHash,
          ),
          Array.from(
            input.aggregationHash,
          ),
        )
        .accounts({
          trainingJob,
          trainingRound,
          authority:
            this.authority,
          systemProgram:
            SYSTEM_PROGRAM_ID,
        })
        .rpc();

    return {
      signature,
      trainingJobAddress:
        trainingJob.toBase58(),
      trainingRoundAddress:
        trainingRound.toBase58(),
    };
  }
}