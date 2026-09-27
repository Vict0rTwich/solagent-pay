use anchor_lang::prelude::*;

use crate::{error::SolAgentError, SPEND_WINDOW_SECS};

/// PDA seeded by `[AGENT_WALLET_SEED, owner, agent]`. Owns the token vault the agent spends from.
#[account]
#[derive(InitSpace)]
pub struct AgentWallet {
    /// Funds the wallet and sets its policy.
    pub owner: Pubkey,
    /// Key the AI agent signs payments with.
    pub agent: Pubkey,
    /// SPL mint the wallet pays in (e.g. USDC).
    pub mint: Pubkey,
    /// Largest single payment, in base units.
    pub max_per_tx: u64,
    /// Total the agent may spend per window, in base units.
    pub daily_limit: u64,
    pub spent_in_window: u64,
    pub window_start: i64,
    pub paused: bool,
    pub bump: u8,
}

impl AgentWallet {
    /// Checks `amount` against the policy and records it, starting a new window if the last one expired.
    pub fn record_spend(&mut self, amount: u64, now: i64) -> Result<()> {
        require!(!self.paused, SolAgentError::WalletPaused);
        require!(amount <= self.max_per_tx, SolAgentError::ExceedsPerTxLimit);

        if now.saturating_sub(self.window_start) >= SPEND_WINDOW_SECS {
            self.window_start = now;
            self.spent_in_window = 0;
        }

        let spent = self
            .spent_in_window
            .checked_add(amount)
            .ok_or(SolAgentError::Overflow)?;
        require!(spent <= self.daily_limit, SolAgentError::ExceedsDailyLimit);
        self.spent_in_window = spent;
        Ok(())
    }
}
