import type { NetworkId } from "./network";

// The payment engine's live event stream (GET /api/dev/events), shared by the server that emits it and the
// dashboard's log drawer that shows it.

export type EngineEventType =
  | "INVOICE_CREATED"
  | "WEBSOCKET_SUBSCRIBED"
  | "TX_DETECTED"
  /** Native SOL: the recipient's lamport change against the amount due. */
  | "LAMPORT_DELTA_VERIFIED"
  /** SPL token (USDC): the recipient's token account change against the amount due. */
  | "TOKEN_DELTA_VERIFIED"
  | "STATUS_UPDATED"
  | "WEBHOOK_DISPATCHED"
  /** A payer's wallet asked for the transaction behind a Solana Action (Blink). */
  | "BLINK_TX_BUILT"
  /** One attempt at minting a buyer's cNFT receipt: minted, simulated (no Underdog key), retrying or failed. */
  | "RECEIPT_MINT"
  /** The server's logsSubscribe websocket for a network changed state. */
  | "SOCKET_STATE";

export interface EngineEvent {
  /** "<boot>:<sequence>": ordered within one server process; `boot` changes when the process restarts. */
  id: string;
  type: EngineEventType;
  /** Unix ms. */
  at: number;
  network: NetworkId | null;
  /** The wallet the invoice pays; null only for server-wide events (socket state). Never sent to other merchants. */
  merchant: string | null;
  reference: string | null;
  data: Record<string, unknown>;
}

/** First message of a stream: where the engine stands when the drawer connects. */
export interface EngineHello {
  bootId: string;
  merchant: string;
  /** logsSubscribe socket state per network the server has opened one for. */
  sockets: Partial<Record<NetworkId, string>>;
}
