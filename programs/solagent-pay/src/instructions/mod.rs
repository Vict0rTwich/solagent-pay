pub mod create_agent_wallet;
pub mod pay;
pub mod update_policy;
pub mod withdraw;

// Each module exports its own `handler`; lib.rs always calls them by path (`pay::handler`),
// so the glob re-exports only need to carry the Accounts structs and events.
#[allow(ambiguous_glob_reexports)]
pub use create_agent_wallet::*;
#[allow(ambiguous_glob_reexports)]
pub use pay::*;
#[allow(ambiguous_glob_reexports)]
pub use update_policy::*;
#[allow(ambiguous_glob_reexports)]
pub use withdraw::*;

use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};

use crate::{state::AgentWallet, AGENT_WALLET_SEED};

/// Transfers `amount` out of the wallet's vault, signing as the agent wallet PDA.
pub(crate) fn transfer_from_vault<'info>(
    wallet: &Account<'info, AgentWallet>,
    vault: &InterfaceAccount<'info, TokenAccount>,
    mint: &InterfaceAccount<'info, Mint>,
    to: &InterfaceAccount<'info, TokenAccount>,
    token_program: &Interface<'info, TokenInterface>,
    amount: u64,
) -> Result<()> {
    let signer_seeds: &[&[&[u8]]] = &[&[
        AGENT_WALLET_SEED,
        wallet.owner.as_ref(),
        wallet.agent.as_ref(),
        &[wallet.bump],
    ]];

    token_interface::transfer_checked(
        CpiContext::new_with_signer(
            token_program.to_account_info(),
            TransferChecked {
                from: vault.to_account_info(),
                mint: mint.to_account_info(),
                to: to.to_account_info(),
                authority: wallet.to_account_info(),
            },
            signer_seeds,
        ),
        amount,
        mint.decimals,
    )
}
