import { apiCall } from "./invoice-api";

// Merchant sign-in (Sign-In with Solana) over the payment server's HTTP API (app/api/auth), shared by its route
// handlers and the dashboard.

/** A sign-in request the server issued: the Wallet Standard `solana:signIn` input. */
export interface SignInInput {
  domain: string;
  address: string;
  statement: string;
  uri: string;
  version: string;
  nonce: string;
  issuedAt: string;
  expirationTime: string;
}

export interface SignInChallenge {
  input: SignInInput;
  /** The exact text to sign, for wallets that only have `signMessage`. */
  message: string;
}

/** Body of POST /api/auth/verify: what the wallet signed and its signature, both base64. */
export interface SignInProof {
  signedMessage: string;
  signature: string;
}

/** The signed-in merchant as the API reports it. The session token itself stays in an HTTP-only cookie. */
export interface MerchantSession {
  address: string;
  /** Unix ms. */
  expiresAt: number;
}

/** A sign-in that didn't complete, worded for the merchant. */
export class SignInError extends Error {
  override readonly name = "SignInError";
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export const authApi = {
  /** The session this browser holds, if any, whichever wallet it's for. */
  session: async () => (await apiCall<{ session: MerchantSession | null }>("/api/auth/session")).session,

  challenge: (address: string) => apiCall<SignInChallenge>("/api/auth/nonce", { method: "POST", body: JSON.stringify({ address }) }),

  verify: async (signedMessage: Uint8Array, signature: Uint8Array) => {
    const proof: SignInProof = { signedMessage: toBase64(signedMessage), signature: toBase64(signature) };
    return (await apiCall<{ session: MerchantSession }>("/api/auth/verify", { method: "POST", body: JSON.stringify(proof) })).session;
  },

  signOut: () => apiCall<{ session: null }>("/api/auth/session", { method: "DELETE" }),
};
