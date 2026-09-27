pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("As8yNFoLRYyHNCthjY3fxRPDi8F41JjobLmQUEFLJcCq");

#[program]
pub mod solagent_pay {
    use super::*;

    /// Owner creates a spending-limited wallet for an agent key, plus a token vault owned by it.
    pub fn create_agent_wallet(
        ctx: Context<CreateAgentWallet>,
        max_per_tx: u64,
        daily_limit: u64,
    ) -> Result<()> {
        create_agent_wallet::handler(ctx, max_per_tx, daily_limit)
    }

    /// Owner changes the wallet's limits or pauses it.
    pub fn update_policy(
        ctx: Context<UpdatePolicy>,
        max_per_tx: u64,
        daily_limit: u64,
        paused: bool,
    ) -> Result<()> {
        update_policy::handler(ctx, max_per_tx, daily_limit, paused)
    }

    /// Agent pays a recipient from the vault, subject to the owner's policy.
    pub fn pay(ctx: Context<Pay>, amount: u64) -> Result<()> {
        pay::handler(ctx, amount)
    }

    /// Owner moves funds out of the vault, bypassing the agent policy.
    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        withdraw::handler(ctx, amount)
    }
}
