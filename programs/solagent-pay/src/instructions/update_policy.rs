use anchor_lang::prelude::*;

use crate::{error::SolAgentError, state::AgentWallet};

#[derive(Accounts)]
pub struct UpdatePolicy<'info> {
    pub owner: Signer<'info>,

    #[account(mut, has_one = owner)]
    pub agent_wallet: Account<'info, AgentWallet>,
}

pub fn handler(
    ctx: Context<UpdatePolicy>,
    max_per_tx: u64,
    daily_limit: u64,
    paused: bool,
) -> Result<()> {
    require!(max_per_tx <= daily_limit, SolAgentError::InvalidPolicy);

    let wallet = &mut ctx.accounts.agent_wallet;
    wallet.max_per_tx = max_per_tx;
    wallet.daily_limit = daily_limit;
    wallet.paused = paused;
    Ok(())
}
