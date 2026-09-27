use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use super::transfer_from_vault;
use crate::{error::SolAgentError, state::AgentWallet};

#[derive(Accounts)]
pub struct Withdraw<'info> {
    pub owner: Signer<'info>,

    #[account(has_one = owner, has_one = mint)]
    pub agent_wallet: Account<'info, AgentWallet>,

    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = agent_wallet,
        associated_token::token_program = token_program,
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,

    #[account(mut, token::mint = mint, token::token_program = token_program)]
    pub destination: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handler(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
    require!(amount > 0, SolAgentError::ZeroAmount);

    let accounts = &ctx.accounts;
    transfer_from_vault(
        &accounts.agent_wallet,
        &accounts.vault,
        &accounts.mint,
        &accounts.destination,
        &accounts.token_program,
        amount,
    )
}
