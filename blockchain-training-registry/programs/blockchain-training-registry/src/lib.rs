use anchor_lang::prelude::*;

declare_id!("AqSVCKJqFTNmnRofWKPSvBxVMXtNohn9i1dXhHCCUskT");

#[program]
pub mod blockchain_training_registry {
    use super::*;

    pub fn register_training_job(
        ctx: Context<RegisterTrainingJob>,
        job_id_hash: [u8; 32],
        model_name: String,
        model_version: String,
        worker_count: u16,
        dataset_hash: [u8; 32],
    ) -> Result<()> {
        require!(!model_name.is_empty(), RegistryError::EmptyModelName);
        require!(
            model_name.len() <= TrainingJob::MAX_MODEL_NAME_LEN,
            RegistryError::ModelNameTooLong
        );

        require!(!model_version.is_empty(), RegistryError::EmptyModelVersion);
        require!(
            model_version.len() <= TrainingJob::MAX_MODEL_VERSION_LEN,
            RegistryError::ModelVersionTooLong
        );

        require!(worker_count > 0, RegistryError::InvalidWorkerCount);

        let job = &mut ctx.accounts.training_job;

        let now = Clock::get()?.unix_timestamp;

        job.authority = ctx.accounts.authority.key();
        job.job_id_hash = job_id_hash;
        job.model_name = model_name;
        job.model_version = model_version;
        job.worker_count = worker_count;
        job.dataset_hash = dataset_hash;
        job.status = TrainingStatus::Registered;
        job.created_at = now;
        job.updated_at = now;
        job.round_count = 0;
        job.bump = ctx.bumps.training_job;

        emit!(TrainingJobRegistered {
            training_job: job.key(),
            authority: job.authority,
            job_id_hash,
            worker_count,
            timestamp: now,
        });

        Ok(())
    }

    pub fn record_training_round(
        ctx: Context<RecordTrainingRound>,
        round_number: u64,
        checkpoint_hash: [u8; 32],
        artifact_hash: [u8; 32],
        aggregation_hash: [u8; 32],
    ) -> Result<()> {
        let job = &mut ctx.accounts.training_job;

        require_keys_eq!(
            job.authority,
            ctx.accounts.authority.key(),
            RegistryError::Unauthorized
        );

        require!(
            round_number == job.round_count as u64 + 1,
            RegistryError::InvalidRoundNumber
        );

        require!(
            job.status != TrainingStatus::Completed
                && job.status != TrainingStatus::Failed,
            RegistryError::JobTerminal
        );

        let now = Clock::get()?.unix_timestamp;

        let round = &mut ctx.accounts.training_round;

        round.training_job = job.key();
        round.round_number = round_number;
        round.checkpoint_hash = checkpoint_hash;
        round.artifact_hash = artifact_hash;
        round.aggregation_hash = aggregation_hash;
        round.created_at = now;
        round.bump = ctx.bumps.training_round;

        job.round_count = job
            .round_count
            .checked_add(1)
            .ok_or(RegistryError::CounterOverflow)?;

        job.updated_at = now;

        emit!(TrainingRoundRecorded {
            training_job: job.key(),
            round: round_number,
            checkpoint_hash,
            artifact_hash,
            aggregation_hash,
            timestamp: now,
        });

        Ok(())
    }

    pub fn update_training_status(
        ctx: Context<UpdateTrainingStatus>,
        new_status: TrainingStatus,
    ) -> Result<()> {
        let job = &mut ctx.accounts.training_job;

        require_keys_eq!(
            job.authority,
            ctx.accounts.authority.key(),
            RegistryError::Unauthorized
        );

        require!(
            is_valid_status_transition(job.status, new_status),
            RegistryError::InvalidStatusTransition
        );

        let now = Clock::get()?.unix_timestamp;
        let previous_status = job.status;

        job.status = new_status;
        job.updated_at = now;

        emit!(TrainingStatusUpdated {
            training_job: job.key(),
            previous_status,
            new_status,
            timestamp: now,
        });

        Ok(())
    }
}

fn is_valid_status_transition(
    current: TrainingStatus,
    next: TrainingStatus,
) -> bool {
    matches!(
        (current, next),
        (TrainingStatus::Registered, TrainingStatus::Running)
            | (TrainingStatus::Registered, TrainingStatus::Failed)
            | (TrainingStatus::Running, TrainingStatus::Completed)
            | (TrainingStatus::Running, TrainingStatus::Failed)
    )
}

#[derive(Accounts)]
#[instruction(job_id_hash: [u8; 32])]
pub struct RegisterTrainingJob<'info> {
    #[account(
        init,
        payer = authority,
        space = TrainingJob::SPACE,
        seeds = [b"training_job", job_id_hash.as_ref()],
        bump
    )]
    pub training_job: Account<'info, TrainingJob>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(round_number: u64)]
pub struct RecordTrainingRound<'info> {
    #[account(
        mut,
        seeds = [b"training_job", training_job.job_id_hash.as_ref()],
        bump = training_job.bump
    )]
    pub training_job: Account<'info, TrainingJob>,

    #[account(
        init,
        payer = authority,
        space = TrainingRound::SPACE,
        seeds = [
            b"training_round",
            training_job.key().as_ref(),
            &round_number.to_le_bytes()
        ],
        bump
    )]
    pub training_round: Account<'info, TrainingRound>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateTrainingStatus<'info> {
    #[account(
        mut,
        seeds = [b"training_job", training_job.job_id_hash.as_ref()],
        bump = training_job.bump
    )]
    pub training_job: Account<'info, TrainingJob>,

    pub authority: Signer<'info>,
}

#[account]
pub struct TrainingJob {
    pub authority: Pubkey,
    pub job_id_hash: [u8; 32],
    pub model_name: String,
    pub model_version: String,
    pub worker_count: u16,
    pub dataset_hash: [u8; 32],
    pub status: TrainingStatus,
    pub created_at: i64,
    pub updated_at: i64,
    pub round_count: u32,
    pub bump: u8,
}

impl TrainingJob {
    pub const MAX_MODEL_NAME_LEN: usize = 64;
    pub const MAX_MODEL_VERSION_LEN: usize = 32;

    pub const SPACE: usize = 8
        + 32
        + 32
        + 4
        + Self::MAX_MODEL_NAME_LEN
        + 4
        + Self::MAX_MODEL_VERSION_LEN
        + 2
        + 32
        + 1
        + 8
        + 8
        + 4
        + 1;
}

#[account]
pub struct TrainingRound {
    pub training_job: Pubkey,
    pub round_number: u64,
    pub checkpoint_hash: [u8; 32],
    pub artifact_hash: [u8; 32],
    pub aggregation_hash: [u8; 32],
    pub created_at: i64,
    pub bump: u8,
}

impl TrainingRound {
    pub const SPACE: usize = 8
        + 32
        + 8
        + 32
        + 32
        + 32
        + 8
        + 1;
}

#[derive(
    AnchorSerialize,
    AnchorDeserialize,
    Clone,
    Copy,
    PartialEq,
    Eq,
)]
pub enum TrainingStatus {
    Registered,
    Running,
    Completed,
    Failed,
}

#[event]
pub struct TrainingJobRegistered {
    pub training_job: Pubkey,
    pub authority: Pubkey,
    pub job_id_hash: [u8; 32],
    pub worker_count: u16,
    pub timestamp: i64,
}

#[event]
pub struct TrainingRoundRecorded {
    pub training_job: Pubkey,
    pub round: u64,
    pub checkpoint_hash: [u8; 32],
    pub artifact_hash: [u8; 32],
    pub aggregation_hash: [u8; 32],
    pub timestamp: i64,
}

#[event]
pub struct TrainingStatusUpdated {
    pub training_job: Pubkey,
    pub previous_status: TrainingStatus,
    pub new_status: TrainingStatus,
    pub timestamp: i64,
}

#[error_code]
pub enum RegistryError {
    #[msg("Model name cannot be empty.")]
    EmptyModelName,

    #[msg("Model name exceeds the maximum allowed length.")]
    ModelNameTooLong,

    #[msg("Model version cannot be empty.")]
    EmptyModelVersion,

    #[msg("Model version exceeds the maximum allowed length.")]
    ModelVersionTooLong,

    #[msg("Worker count must be greater than zero.")]
    InvalidWorkerCount,

    #[msg("Caller is not authorized for this training job.")]
    Unauthorized,

    #[msg("Invalid training round number.")]
    InvalidRoundNumber,

    #[msg("Training job is already in a terminal state.")]
    JobTerminal,

    #[msg("Invalid training status transition.")]
    InvalidStatusTransition,

    #[msg("Counter overflow.")]
    CounterOverflow,
}
