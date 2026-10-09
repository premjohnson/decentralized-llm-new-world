import test from "node:test";
import assert from "node:assert/strict";

import {
  Keypair,
  PublicKey,
} from "@solana/web3.js";

import { BlockchainClient } from "../src/modules/blockchain/blockchain.client.js";
import { hashJobId } from "../src/modules/blockchain/blockchain.crypto.js";

const PROGRAM_ID = new PublicKey(
  "AqSVCKJqFTNmnRofWKPSvBxVMXtNohn9i1dXhHCCUskT",
);

const WALLET_PATH =
  process.env.SOLANA_WALLET_PATH ??
  `${process.env.HOME}/.config/solana/id.json`;

const RPC_URL =
  process.env.SOLANA_RPC_URL ??
  "https://api.devnet.solana.com";

const client = new BlockchainClient(
  RPC_URL,
  WALLET_PATH,
);

test("uses the expected Solana program ID", () => {
  assert.equal(
    client.programId.toBase58(),
    PROGRAM_ID.toBase58(),
  );
});

test("derives deterministic TrainingJob PDA", () => {
  const jobId =
    "550e8400-e29b-41d4-a716-446655440000";

  const jobIdHash = hashJobId(jobId);

  const actual =
    client.getTrainingJobPda(jobIdHash);

  const [expected] =
    PublicKey.findProgramAddressSync(
      [
        Buffer.from("training_job"),
        Buffer.from(jobIdHash),
      ],
      PROGRAM_ID,
    );

  assert.equal(
    actual.toBase58(),
    expected.toBase58(),
  );
});

test("derives the same TrainingJob PDA for the same job ID", () => {
  const jobId =
    "550e8400-e29b-41d4-a716-446655440000";

  const first =
    client.getTrainingJobPda(
      hashJobId(jobId),
    );

  const second =
    client.getTrainingJobPda(
      hashJobId(jobId),
    );

  assert.equal(
    first.toBase58(),
    second.toBase58(),
  );
});

test("different job IDs produce different TrainingJob PDAs", () => {
  const first =
    client.getTrainingJobPda(
      hashJobId("job-001"),
    );

  const second =
    client.getTrainingJobPda(
      hashJobId("job-002"),
    );

  assert.notEqual(
    first.toBase58(),
    second.toBase58(),
  );
});

test("derives deterministic TrainingRound PDA", () => {
  const jobId =
    "550e8400-e29b-41d4-a716-446655440000";

  const jobIdHash = hashJobId(jobId);

  const trainingJob =
    client.getTrainingJobPda(jobIdHash);

  const roundNumber = 1;

  const actual =
    client.getTrainingRoundPda(
      trainingJob,
      roundNumber,
    );

  const roundNumberBuffer = Buffer.alloc(8);

  roundNumberBuffer.writeBigUInt64LE(
    BigInt(roundNumber),
  );

  const [expected] =
    PublicKey.findProgramAddressSync(
      [
        Buffer.from("training_round"),
        trainingJob.toBuffer(),
        roundNumberBuffer,
      ],
      PROGRAM_ID,
    );

  assert.equal(
    actual.toBase58(),
    expected.toBase58(),
  );
});

test("different round numbers produce different TrainingRound PDAs", () => {
  const trainingJob =
    client.getTrainingJobPda(
      hashJobId("job-round-test"),
    );

  const roundOne =
    client.getTrainingRoundPda(
      trainingJob,
      1,
    );

  const roundTwo =
    client.getTrainingRoundPda(
      trainingJob,
      2,
    );

  assert.notEqual(
    roundOne.toBase58(),
    roundTwo.toBase58(),
  );
});

test("rejects invalid job hash length", () => {
  assert.throws(
    () =>
      client.getTrainingJobPda(
        new Uint8Array(31),
      ),
    /jobIdHash must contain exactly 32 bytes/,
  );
});

test("rejects invalid round number", () => {
  const trainingJob =
    Keypair.generate().publicKey;

  assert.throws(
    () =>
      client.getTrainingRoundPda(
        trainingJob,
        0,
      ),
    /roundNumber must be a positive safe integer/,
  );
});