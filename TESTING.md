# Testing baseline

This document records the testing baseline checked on 2026-11-04. Run commands from the repository root unless otherwise stated.

## Environment

- Node.js **22.17.0** and npm **10.9.2** are the baseline; `.nvmrc` pins Node for nvm and CI. Install dependencies with `npm ci`, using the committed lockfile.
- Anchor contract development requires Linux or WSL2. The tested Ubuntu 24.04 environment has Anchor CLI **0.32.1**, Solana CLI and validator **2.3.0**, host Rust/Cargo **1.98.1**, and Solana platform-tools **v1.48** with Rust **1.84.1**. The program declares Rust 1.84 compatibility; host compiler and SBF compiler are different toolchains. The committed Cargo lockfile resolves `anchor-lang` and `anchor-spl` to **0.32.2**, allowed by their `0.32.1` dependency ranges; the build and suite below used those locked versions with CLI 0.32.1.
- In WSL, initialize nvm if the shell does not do so automatically: `source ~/.nvm/nvm.sh`, then `nvm install` and `nvm use` from the repository root. Use a Linux checkout and a Linux `npm ci` rather than sharing Windows `node_modules` with WSL.
- The web tests use temporary files and can open a connection to a localnet listener. They do not submit chain transactions. Keep local development credentials and payment data out of test fixtures.

## Non-transactional checks

```sh
nvm use
npm ci
npm run build -w sdk
npm run typecheck -w sdk
npm run typecheck -w mcp-server
npm run typecheck -w web
npm test -w sdk
npm test -w web
```

The SDK build is needed before web imports resolve against the workspace package. `web` typecheck also builds the SDK. The workflow in `.github/workflows/test.yml` runs this sequence on Ubuntu 24.04 for pushes, pull requests and manual dispatches. It also has a separate isolated local-validator job. The workflow itself has not yet run on GitHub.

Results on 2026-11-04: a fresh Ubuntu 24.04 temporary checkout at commit `d58194da7497f85c8a7c58e5753dd76557a36731`, with Node 22.17.0 and npm 10.9.2, passed `npm ci`, SDK build, all three typechecks, 11 SDK tests and 42 web tests. The same SDK and web tests passed on Windows outside the managed sandbox. No assertions were changed. The clean checkout tested the workflow's commands; the new workflow file was not included in that archived checkout.

### Windows sandbox failure

In the managed Windows sandbox, `node -e "console.log(require('os').userInfo())"` fails with `uv_os_get_passwd` / `ENOMEM`; the same command works outside that sandbox. The installed `tsx` calls `os.userInfo()` during startup on Windows, so both test commands fail before any tests run there. Run them in a normal user session or in WSL with Linux Node and Linux-installed dependencies. This is an environment limitation, not evidence of a test failure or a reason to weaken tests. Windows may also log that optional bigint native bindings are unavailable; its JavaScript fallback passed the tests.

## Anchor local-validator tests

On 2026-11-04, two fresh isolated Ubuntu 24.04 checkouts each built successfully and the suite passed **11 tests, 0 failed** in each run. Each used new disposable owner and program keypairs, a local validator, and the test-created SPL mint. No real wallet or public RPC was used. The disposable program key requires a matching local program ID, so `anchor keys sync` changed the ID only in the temporary checkout; this does not verify the deployed Devnet binary. After the second Anchor run, the SDK build and all three typechecks passed, followed by 11 SDK tests and 42 web tests with no failures.

The following commands must be run in a **disposable checkout**, never a working checkout containing a real program keypair. They change the checkout's program ID, create a local ledger, deploy to the local validator, and submit local test transactions. Ensure ports 8899 and 8900 are free and no provider or wallet environment overrides are set. Use Linux Node and run `npm ci` first.

```sh
unset ANCHOR_PROVIDER_URL ANCHOR_WALLET SOLANA_URL
mkdir -p target/deploy local-test-wallet
solana-keygen new --no-bip39-passphrase --silent --outfile local-test-wallet/owner.json
solana-keygen new --no-bip39-passphrase --silent --outfile target/deploy/solagent_pay-keypair.json
anchor keys sync
anchor build
anchor test --skip-build --provider.cluster localnet --provider.wallet "$PWD/local-test-wallet/owner.json"
```

The owner keypair above is for an ephemeral checkout only; never reuse a real keypair. The CI job similarly creates fresh keys, pins and checksum-verifies the tool downloads, and explicitly selects localnet. Both pinned release downloads were independently downloaded, checksum-verified, and checked for the expected CLI versions in Ubuntu. Do not run the test against Devnet or Mainnet.

## Devnet read-only observation

At finalized slot 518682287, `getAccountInfo` reported the configured program `As8yNFoLRYyHNCthjY3fxRPDi8F41JjobLmQUEFLJcCq` as executable under the upgradeable BPF loader. Its program-data account is `395nfkv4StRustAykUUuqsELHMv4Qrk2jhBgJAW8X3Nt`; a subsequent read reported upgrade authority `3fAD6MLcz4SdqAGfEn42ax8nK5YWHZn2UufYo2ESKDaY` and deployment slot 503366858. These observations do not verify authority ownership, deployed binary/source equivalence, or payment functionality. A later read-only check can use `solana program show --url devnet As8yNFoLRYyHNCthjY3fxRPDi8F41JjobLmQUEFLJcCq`.

## Remaining baseline gaps

- Observe the new workflow, including its tool installation and local-validator job, on GitHub after the changes are reviewed and pushed.
- Add meaningful integration and adversarial coverage for SDK-to-program payments, MCP, settlement, concurrency and recovery; passing existing unit tests does not verify those flows.
- Review lockfile dependency advisories separately. The clean install emitted deprecation warnings; this phase did not update payment dependencies or assess every advisory.
