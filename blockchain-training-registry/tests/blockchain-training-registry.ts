import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { expect } from "chai";
import { BN } from "bn.js";
import { BlockchainTrainingRegistry } from "../target/types/blockchain_training_registry";

describe("blockchain-training-registry", () => {
  anchor.setProvider(anchor.AnchorProvider.env());

  const program =
    anchor.workspace.blockchainTrainingRegistry as Program<BlockchainTrainingRegistry>;

  const provider = anchor.getProvider() as anchor.AnchorProvider;
  const authority = provider.wallet;

  /*
   * Generate a unique job ID for every test execution.
   *
   * This is important on Devnet because accounts persist
   * after the test finishes.
   */
  const jobIdHash = Array.from(
    { length: 32 },
    () => Math.floor(Math.random() * 256)
  );

  const datasetHash = Array.from(
    { length: 32 },
    (_, i) => i + 101
  );

  const modelName = "llama-3.2-1b";
  const modelVersion = "v1.0.0";

  let trainingJobPda: anchor.web3.PublicKey;
  let trainingRoundPda: anchor.web3.PublicKey;

  before(async () => {
    [trainingJobPda] =
      anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("training_job"),
          Buffer.from(jobIdHash),
        ],
        program.programId
      );
  });

  it("registers a training job", async () => {
    const tx = await program.methods
      .registerTrainingJob(
        jobIdHash,
        modelName,
        modelVersion,
        2,
        datasetHash
      )
      .accountsPartial({
        authority: authority.publicKey,
        trainingJob: trainingJobPda,
      })
      .rpc();

    console.log(
      "register_training_job tx:",
      tx
    );

    const job =
      await program.account.trainingJob.fetch(
        trainingJobPda
      );

    expect(
      job.authority.toBase58()
    ).to.equal(
      authority.publicKey.toBase58()
    );

    expect(job.modelName).to.equal(
      modelName
    );

    expect(job.modelVersion).to.equal(
      modelVersion
    );

    expect(job.workerCount).to.equal(
      2
    );

    expect(job.roundCount).to.equal(
      0
    );

    expect(
      job.status.registered
    ).to.not.equal(undefined);
  });

  it("moves the training job to running", async () => {
    const tx = await program.methods
      .updateTrainingStatus({
        running: {},
      })
      .accountsPartial({
        authority: authority.publicKey,
        trainingJob: trainingJobPda,
      })
      .rpc();

    console.log(
      "running status tx:",
      tx
    );

    const job =
      await program.account.trainingJob.fetch(
        trainingJobPda
      );

    expect(
      job.status.running
    ).to.not.equal(undefined);
  });

  it("records training round 1", async () => {
    const roundNumber = new BN(1);

    [trainingRoundPda] =
      anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("training_round"),
          trainingJobPda.toBuffer(),
          roundNumber.toArrayLike(
            Buffer,
            "le",
            8
          ),
        ],
        program.programId
      );

    const checkpointHash = Array.from(
      { length: 32 },
      (_, i) => i + 1
    );

    const artifactHash = Array.from(
      { length: 32 },
      (_, i) => i + 33
    );

    const aggregationHash = Array.from(
      { length: 32 },
      (_, i) => i + 65
    );

    const tx = await program.methods
      .recordTrainingRound(
        roundNumber,
        checkpointHash,
        artifactHash,
        aggregationHash
      )
      .accountsPartial({
        authority: authority.publicKey,
        trainingJob: trainingJobPda,
        trainingRound: trainingRoundPda,
      })
      .rpc();

    console.log(
      "record_training_round tx:",
      tx
    );

    const job =
      await program.account.trainingJob.fetch(
        trainingJobPda
      );

    const round =
      await program.account.trainingRound.fetch(
        trainingRoundPda
      );

    expect(
      job.roundCount
    ).to.equal(1);

    expect(
      round.trainingJob.toBase58()
    ).to.equal(
      trainingJobPda.toBase58()
    );

    expect(
      round.roundNumber.toNumber()
    ).to.equal(1);
  });

  it("rejects an invalid round number", async () => {
    const invalidRoundNumber =
      new BN(3);

    const invalidRoundPda =
      anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("training_round"),
          trainingJobPda.toBuffer(),
          invalidRoundNumber.toArrayLike(
            Buffer,
            "le",
            8
          ),
        ],
        program.programId
      )[0];

    const hash = Array.from(
      { length: 32 },
      (_, i) => i + 1
    );

    try {
      await program.methods
        .recordTrainingRound(
          invalidRoundNumber,
          hash,
          hash,
          hash
        )
        .accountsPartial({
          authority: authority.publicKey,
          trainingJob: trainingJobPda,
          trainingRound: invalidRoundPda,
        })
        .rpc();

      expect.fail(
        "Expected invalid round number to be rejected"
      );
    } catch (error: any) {
      expect(
        error.error.errorCode.code
      ).to.equal(
        "InvalidRoundNumber"
      );
    }
  });

  it("rejects unauthorized status updates", async () => {
    const attacker =
      anchor.web3.Keypair.generate();

    const signature =
      await provider.connection.requestAirdrop(
        attacker.publicKey,
        anchor.web3.LAMPORTS_PER_SOL
      );

    await provider.connection.confirmTransaction(
      signature
    );

    try {
      await program.methods
        .updateTrainingStatus({
          completed: {},
        })
        .accountsPartial({
          authority: attacker.publicKey,
          trainingJob: trainingJobPda,
        })
        .signers([attacker])
        .rpc();

      expect.fail(
        "Expected unauthorized update to fail"
      );
    } catch (error: any) {
      expect(
        error.error.errorCode.code
      ).to.equal(
        "Unauthorized"
      );
    }
  });

  it("rejects invalid status transition", async () => {
    try {
      await program.methods
        .updateTrainingStatus({
          registered: {},
        })
        .accountsPartial({
          authority: authority.publicKey,
          trainingJob: trainingJobPda,
        })
        .rpc();

      expect.fail(
        "Expected invalid status transition to fail"
      );
    } catch (error: any) {
      expect(
        error.error.errorCode.code
      ).to.equal(
        "InvalidStatusTransition"
      );
    }
  });

  it("completes the training job", async () => {
    const tx = await program.methods
      .updateTrainingStatus({
        completed: {},
      })
      .accountsPartial({
        authority: authority.publicKey,
        trainingJob: trainingJobPda,
      })
      .rpc();

    console.log(
      "completed status tx:",
      tx
    );

    const job =
      await program.account.trainingJob.fetch(
        trainingJobPda
      );

    expect(
      job.status.completed
    ).to.not.equal(undefined);
  });

  it("rejects updates after the job is completed", async () => {
    try {
      await program.methods
        .updateTrainingStatus({
          failed: {},
        })
        .accountsPartial({
          authority: authority.publicKey,
          trainingJob: trainingJobPda,
        })
        .rpc();

      expect.fail(
        "Expected terminal job update to fail"
      );
    } catch (error: any) {
      expect(
        error.error.errorCode.code
      ).to.equal(
        "InvalidStatusTransition"
      );
    }
  });
});