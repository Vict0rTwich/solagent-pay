// Invoked by `anchor migrate` with a provider configured from Anchor.toml.

import * as anchor from "@coral-xyz/anchor";

module.exports = async function (provider: anchor.AnchorProvider) {
  anchor.setProvider(provider);
  // Add post-deploy setup here.
};
