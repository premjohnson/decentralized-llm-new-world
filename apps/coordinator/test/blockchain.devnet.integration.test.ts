import test from "node:test";
import assert from "node:assert/strict";

import { BlockchainClient } from "../src/modules/blockchain/blockchain.client.js";
import { hashJobId } from "../src/modules/blockchain/blockchain.crypto.js";

const RUN_DEVNET_TEST =
  process.env.RUN_SOLANA_DEVNET_TEST === "true";

const RPC_URL =
  process.env.SOLANA_RPC_URL ??
  "https://api.devnet.solana.com";

const WALLET_PATH =
  process.env.SOLANA_WALLET_PATH ??
  `${process.env.HOME}/.config/solana/id.json`;

test(
  "registers and reads a TrainingJob on Solana Devnet",
  {
    skip: !RUN_DEVNET_TEST,
    timeout: 120_000,
  },
  async () => {
    if (!RUN_DEVNET_TEST) {
      return;
    }

    // Initialize the wallet and client only when explicitly enabled.
    const client = new BlockchainClient(
      RPC_URL,
      WALLET_PATH,
    );

    /*
     * Generate a unique job ID so this test can be
     * safely executed multiple times.
     */
    const jobId =
      `devnet-integration-${Date.now()}`;

    const modelName = "llama-3.2-1b";
    const modelVersion = "v1.0.0";
    const workerCount = 2;

    const datasetHash = new Uint8Array(
      Array.from(
        { length: 32 },
        (_, index) => index + 1,
      ),
    );

    console.log("");
    console.log("========================================");
    console.log("Solana Devnet Integration Test");
    console.log("========================================");

    console.log(
      `Program: ${client.programId.toBase58()}`,
    );

    console.log(
      `Authority: ${client.authority.toBase58()}`,
    );

    console.log(`Job ID: ${jobId}`);

    const balance = await client.getBalance();

    console.log(`Wallet balance: ${balance} SOL`);

    assert.ok(
      balance > 0,
      "Coordinator wallet must have SOL",
    );

    /*
     * Verify that the account does not already exist.
     */
    const before = await client.getTrainingJob(jobId);

    assert.equal(
      before,
      null,
      "TrainingJob should not exist before registration",
    );

    /*
     * Calculate the deterministic hash and PDA.
     */
    const expectedJobIdHash = hashJobId(jobId);

    assert.equal(expectedJobIdHash.length, 32);

    const expectedPda = client.getTrainingJobPda(
      expectedJobIdHash,
    );

    console.log(
      `TrainingJob PDA: ${expectedPda.toBase58()}`,
    );

    /*
     * This submits a REAL transaction to Solana Devnet.
     */
    console.log("Registering TrainingJob on Devnet...");

    const result = await client.registerTrainingJob({
      jobId,
      modelName,
      modelVersion,
      workerCount,
      datasetHash,
    });

    console.log(`Transaction: ${result.signature}`);

    console.log(
      `TrainingJob: ${result.trainingJobAddress}`,
    );

    /*
     * The returned address must match our deterministic PDA.
     */
    assert.equal(
      result.trainingJobAddress,
      expectedPda.toBase58(),
    );

    assert.ok(
      result.signature.length > 0,
      "Transaction signature must be returned",
    );

    /*
     * Fetch the actual account from Devnet.
     */
    console.log("Fetching TrainingJob from Devnet...");

    const account = await client.getTrainingJob(jobId);

    assert.ok(
      account,
      "TrainingJob account must exist after registration",
    );

    /*
     * Verify the on-chain address.
     */
    assert.equal(
      account.address,
      expectedPda.toBase58(),
    );

    /*
     * Verify job ID hash.
     */
    assert.deepEqual(
      account.jobIdHash,
      Array.from(expectedJobIdHash),
    );

    /*
     * Verify model metadata.
     */
    assert.equal(account.modelName, modelName);
    assert.equal(account.modelVersion, modelVersion);

    /*
     * Verify worker count.
     */
    assert.equal(account.workerCount, workerCount);

    /*
     * Verify dataset hash.
     */
    assert.deepEqual(
      account.datasetHash,
      Array.from(datasetHash),
    );

    /*
     * A newly registered job must start in the Registered state.
     */
    assert.deepEqual(account.status, {
      registered: {},
    });

    /*
     * A newly registered job must not have any training rounds.
     */
    assert.equal(
      account.roundCount.toString(),
      "0",
    );

    /*
     * Timestamps must exist.
     */
    assert.ok(account.createdAt);
    assert.ok(account.updatedAt);

    console.log("");
    console.log("========================================");
    console.log("DEVNET REGISTRATION SUCCESS");
    console.log("========================================");

    console.log(`TrainingJob PDA: ${account.address}`);
    console.log(`Model: ${account.modelName}`);
    console.log(`Version: ${account.modelVersion}`);
    console.log(`Workers: ${account.workerCount}`);

    console.log(
      `Status: ${JSON.stringify(account.status)}`,
    );

    console.log(
      `Rounds: ${account.roundCount.toString()}`,
    );

    console.log(`Transaction: ${result.signature}`);

    console.log("========================================");
    console.log("");
  },
);
