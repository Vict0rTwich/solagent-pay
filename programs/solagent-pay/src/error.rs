use anchor_lang::prelude::*;

#[error_code]
pub enum SolAgentError {
    #[msg("Agent wallet is paused by its owner")]
    WalletPaused,
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Payment exceeds the per-transaction limit")]
    ExceedsPerTxLimit,
    #[msg("Payment exceeds the daily spending limit")]
    ExceedsDailyLimit,
    #[msg("Per-transaction limit cannot exceed the daily limit")]
    InvalidPolicy,
    #[msg("Arithmetic overflow")]
    Overflow,
}
