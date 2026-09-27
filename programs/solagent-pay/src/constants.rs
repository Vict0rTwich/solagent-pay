use anchor_lang::prelude::*;

#[constant]
pub const AGENT_WALLET_SEED: &[u8] = b"agent_wallet";

/// Length of the spending window that `daily_limit` applies to.
pub const SPEND_WINDOW_SECS: i64 = 24 * 60 * 60;
