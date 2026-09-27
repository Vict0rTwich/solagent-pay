use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{Mint, TokenAccount, TokenInterface},
};

use crate::{error::SolAgentError, state::AgentWallet, AGENT_WALLET_SEED};

#[derive(Accounts)]
pub struct CreateAgentWallet<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    /// CHECK: only recorded; the agent proves control by signing `pay`.
    pub agent: UncheckedAccount<'info>,

    #[account(
        init,
        payer = owner,
        space = 8 + AgentWallet::INIT_SPACE,
        seeds = [AGENT_WALLET_SEED, owner.key().as_ref(), agent.key().as_ref()],
        bump,
    )]
    pub agent_wallet: Account<'info, AgentWallet>,

    #[account(mint::token_program = token_program)]
    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        init,
        payer = owner,
        associated_token::mint = mint,
        associated_token::authority = agent_wallet,
        associated_token::token_program = token_program,
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<CreateAgentWallet>, max_per_tx: u64, daily_limit: u64) -> Result<()> {
    require!(max_per_tx <= daily_limit, SolAgentError::InvalidPolicy);

    ctx.accounts.agent_wallet.set_inner(AgentWallet {
        owner: ctx.accounts.owner.key(),
        agent: ctx.accounts.agent.key(),
        mint: ctx.accounts.mint.key(),
        max_per_tx,
        daily_limit,
        spent_in_window: 0,
        window_start: Clock::get()?.unix_timestamp,
        paused: false,
        bump: ctx.bumps.agent_wallet,
    });
    Ok(())
}
