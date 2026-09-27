use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use super::transfer_from_vault;
use crate::{error::SolAgentError, state::AgentWallet, AGENT_WALLET_SEED};

#[derive(Accounts)]
pub struct Pay<'info> {
    pub agent: Signer<'info>,

    #[account(
        mut,
        seeds = [AGENT_WALLET_SEED, agent_wallet.owner.as_ref(), agent.key().as_ref()],
        bump = agent_wallet.bump,
        has_one = agent,
        has_one = mint,
    )]
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
    pub recipient_token_account: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
}

#[event]
pub struct PaymentSent {
    pub agent_wallet: Pubkey,
    pub recipient_token_account: Pubkey,
    pub amount: u64,
    pub spent_in_window: u64,
}

pub fn handler(ctx: Context<Pay>, amount: u64) -> Result<()> {
    require!(amount > 0, SolAgentError::ZeroAmount);

    ctx.accounts
        .agent_wallet
        .record_spend(amount, Clock::get()?.unix_timestamp)?;

    let accounts = &ctx.accounts;
    transfer_from_vault(
        &accounts.agent_wallet,
        &accounts.vault,
        &accounts.mint,
        &accounts.recipient_token_account,
        &accounts.token_program,
        amount,
    )?;

    emit!(PaymentSent {
        agent_wallet: accounts.agent_wallet.key(),
        recipient_token_account: accounts.recipient_token_account.key(),
        amount,
        spent_in_window: accounts.agent_wallet.spent_in_window,
    });
    Ok(())
}
