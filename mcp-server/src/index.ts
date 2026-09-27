#!/usr/bin/env node
import { AnchorError } from "@coral-xyz/anchor";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SolAgentPayClient } from "@solagent-pay/sdk";
import { Connection, PublicKey } from "@solana/web3.js";
import { z } from "zod";

import { loadConfig } from "./config.js";

// stdout carries the MCP protocol, so all logging goes to stderr.
const log = (...args: unknown[]) => console.error("[solagent-pay]", ...args);

async function main() {
  const config = loadConfig();
  const client = SolAgentPayClient.fromKeypair(
    new Connection(config.rpcUrl, "confirmed"),
    config.agentKeypair,
  );
  const agentWallet = client.findAgentWallet(config.owner, config.agentKeypair.publicKey);

  const server = new McpServer({ name: "solagent-pay", version: "0.1.0" });

  server.registerTool(
    "get_wallet_status",
    {
      title: "Get agent wallet status",
      description:
        "Balance, spending limits and remaining daily allowance of this agent's payment wallet. " +
        "Amounts are in whole token units.",
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async () => {
      try {
        const status = await client.getStatus(agentWallet);
        return text(JSON.stringify(status, null, 2));
      } catch (err) {
        return failure(err);
      }
    },
  );

  server.registerTool(
    "pay",
    {
      title: "Pay a recipient",
      description:
        "Send tokens from this agent's wallet to a recipient's Solana address. " +
        "The owner's per-transaction and daily limits are enforced on-chain; " +
        "check get_wallet_status first if unsure.",
      inputSchema: {
        recipient: z.string().describe("Recipient wallet address (base58)"),
        amount: z
          .string()
          .regex(/^\d+(\.\d+)?$/)
          .describe('Amount in whole token units, e.g. "1.25"'),
      },
      annotations: { destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ recipient, amount }) => {
      try {
        const signature = await client.pay({
          agentWallet,
          recipient: new PublicKey(recipient),
          amount,
        });
        return text(`Paid ${amount} to ${recipient}. Signature: ${signature}`);
      } catch (err) {
        return failure(err);
      }
    },
  );

  await server.connect(new StdioServerTransport());
  log(`ready — agent ${config.agentKeypair.publicKey.toBase58()}, wallet ${agentWallet.toBase58()}`);
}

function text(message: string) {
  return { content: [{ type: "text" as const, text: message }] };
}

function failure(err: unknown) {
  const message =
    err instanceof AnchorError
      ? `${err.error.errorCode.code}: ${err.error.errorMessage}`
      : err instanceof Error
        ? err.message
        : String(err);
  log("tool call failed:", message);
  return { ...text(message), isError: true };
}

main().catch((err) => {
  log(err instanceof Error ? err.message : err);
  process.exit(1);
});
