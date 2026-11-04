# SolAgent Pay

Policy-limited payment wallets for autonomous AI agents on Solana. An **owner** funds a wallet and sets
per-transaction and daily limits; an **agent** key can spend from it only within those limits, enforced on-chain.

```
.
├── Anchor.toml                  # Anchor 0.32.1, npm, localnet/devnet program IDs
├── Cargo.toml                   # Rust workspace (programs/*)
├── package.json                 # npm workspaces: sdk, mcp-server; test + build scripts
├── tsconfig.base.json           # shared TS options
├── tsconfig.json                # tests/ + migrations/ (ts-mocha)
├── programs/solagent-pay/       # Anchor program
│   ├── Cargo.toml               # anchor-lang + anchor-spl 0.32.1
│   └── src/
│       ├── lib.rs               # #[program] entrypoints
│       ├── constants.rs         # PDA seed, spend window
│       ├── error.rs
│       ├── state.rs             # AgentWallet account + spend policy
│       └── instructions/        # create_agent_wallet, update_policy, pay, withdraw
├── sdk/                         # @solagent-pay/sdk — TS client for agent wallets
│   └── src/{client,pda,amounts,index}.ts, idl/ (synced from target/)
├── mcp-server/                  # @solagent-pay/mcp-server — MCP tools: get_wallet_status, pay
│   └── src/{index,config}.ts
├── tests/solagent-pay.ts        # anchor test suite
├── migrations/deploy.ts
└── scripts/sync-idl.mjs         # target/{idl,types} -> sdk/src/idl
```

## Setup

For pinned toolchain versions, non-transactional checks, the local-validator test restriction, and the latest baseline results, see [TESTING.md](TESTING.md).

Anchor does not support native Windows. On Windows, work inside WSL2 (from PowerShell: `wsl --install -d Ubuntu-24.04`).

```bash
# Rust, Solana CLI, AVM + Anchor, Node (official installer)
curl --proto '=https' --tlsv1.2 -sSfL https://solana-install.solana.workers.dev | bash
avm install 0.32.1 && avm use 0.32.1
solana-keygen new          # dev wallet at ~/.config/solana/id.json, if you don't have one
```

Keep the project on the Linux filesystem, not `/mnt/c/...`: builds are much faster there.

```bash
mkdir -p ~/solagent-pay && cp -r "/mnt/c/Users/TWICH/Documents/SolAgent Pay/." ~/solagent-pay/
```

```bash
npm install
anchor build               # first build creates target/deploy/solagent_pay-keypair.json
anchor keys sync           # writes that program ID into lib.rs and Anchor.toml
npm run build              # anchor build -> sync IDL into sdk -> build sdk + mcp-server
anchor test                # local validator + tests/solagent-pay.ts (Anchor.toml's cluster is localnet)
npm run test -w sdk        # x402 paywall tests
anchor deploy --provider.cluster devnet   # deploy (or upgrade) on devnet: needs devnet SOL in your wallet
```

Back up `target/deploy/solagent_pay-keypair.json`: it is the program's upgrade identity and `target/` is gitignored.

### Rust 1.84 constraint

`cargo build-sbf` uses the Cargo/rustc bundled with Solana 2.3's platform-tools (1.84), which can't
build edition-2024 crates. Two things keep the dependency tree compatible:

- `rust-version = "1.84"` in the program's `Cargo.toml` plus `.cargo/config.toml`
  (`incompatible-rust-versions = "fallback"`) make `cargo update` skip crate versions that declare a newer Rust.
- `blake3` is pinned to `=1.8.2` under `[target.'cfg(any())'.dependencies]`, because newer releases moved to
  edition 2024 without declaring a `rust-version`, so the resolver can't detect them.

If a new dependency brings back `feature edition2024 is required`, find its parent with
`cargo tree -i <crate>` and pin it the same way. Commit `Cargo.lock`.

## MCP server

Needs a deployed program and an agent wallet created by its owner (`SolAgentPayClient.createAgentWallet`).

| Variable | Meaning |
| --- | --- |
| `AGENT_KEYPAIR_PATH` | Agent's keypair JSON. Signs payments and pays fees, so it needs a little SOL. |
| `AGENT_WALLET_OWNER` | Owner pubkey that created this agent's wallet |
| `SOLANA_RPC_URL` | Defaults to devnet |

```bash
claude mcp add solagent-pay \
  -e AGENT_KEYPAIR_PATH=~/.config/solana/agent.json \
  -e AGENT_WALLET_OWNER=<owner-pubkey> \
  -e SOLANA_RPC_URL=https://api.devnet.solana.com \
  -- node ~/solagent-pay/mcp-server/dist/index.js
```

## Starting from scratch with the Anchor CLI

This repo roughly corresponds to:

```bash
anchor init solagent-pay --template multiple --no-install
cd solagent-pay
npm init -y -w sdk -w mcp-server
npm install @coral-xyz/anchor@^0.32.1 @solana/web3.js@~1.98.4 @solana/spl-token
cargo add anchor-spl@0.32.1 --package solagent-pay
npm install -w mcp-server @modelcontextprotocol/sdk zod
```

After `cargo add anchor-spl`, also add `"anchor-spl/idl-build"` to the program's `idl-build` feature, or IDL generation fails for SPL account types.
