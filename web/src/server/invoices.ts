import { baseUnits, currencyMint, currencyOfMint, type Currency } from "@/lib/currency";
import { NETWORKS, type NetworkId } from "@/lib/network";
import { buildTransferRequest, createReference } from "@/lib/solana-pay";
import type { Product } from "@/lib/types";

import { serverConfig } from "./config";
import type { PaymentRuntime } from "./runtime";
import type { InvoiceRecord } from "./store";

/** Where an invoice came from, for the event log. */
export type InvoiceSource = "dashboard" | "api-key" | "blink";

export interface OpenInvoiceInput {
  network: NetworkId;
  kind: "invoice" | "link";
  recipient: string;
  currency: Currency;
  /** In `currency`'s units, canonical. */
  amount: string;
  memo: string;
  /** Set for an order of a product. */
  product: Product | null;
  issueReceipt: boolean;
  ttlMs: number;
  source: InvoiceSource;
  apiKey?: { id: string; name: string } | null;
}

/** An order of `product`: its price, currency and title, as the product reads now. */
export function orderOf(product: Product): Pick<OpenInvoiceInput, "network" | "kind" | "recipient" | "currency" | "amount" | "memo" | "product"> {
  return {
    network: product.network,
    kind: "link",
    recipient: product.merchant,
    currency: currencyOfMint(product.mint) ?? "USDC",
    amount: product.amount,
    memo: product.title,
    product,
  };
}

/**
 * Stores a new invoice the server watches and settles, and starts watching it. The server picks the reference key,
 * the mint (the network's USDC, never one a caller names) and the invoice number. Throws StoreError
 * "too_many_open" when the server is watching as many invoices as it will.
 */
export async function openInvoice(runtime: PaymentRuntime, input: OpenInvoiceInput): Promise<InvoiceRecord> {
  await runtime.start();
  const mint = currencyMint(input.currency, NETWORKS[input.network]);
  const reference = createReference();
  const invoice = await runtime.store.create(
    {
      reference,
      network: input.network,
      kind: input.kind,
      recipient: input.recipient,
      mint,
      amount: input.amount,
      memo: input.memo,
      paymentUrl: (id) =>
        buildTransferRequest({
          recipient: input.recipient,
          amount: input.amount,
          splToken: mint,
          reference,
          label: "SolAgent Pay",
          message: input.memo || undefined,
          memo: id,
        }),
      expiresAt: Date.now() + input.ttlMs,
      product: input.product
        ? { id: input.product.id, info: { title: input.product.title, description: input.product.description, image: input.product.image } }
        : null,
      issueReceipt: input.issueReceipt,
    },
    serverConfig.maxOpenInvoices,
  );
  runtime.events.emit({
    type: "INVOICE_CREATED",
    network: invoice.network,
    merchant: invoice.recipient,
    reference: invoice.reference,
    data: {
      invoiceId: invoice.id,
      kind: invoice.kind,
      source: input.source,
      reference: invoice.reference,
      recipient: invoice.recipient,
      currency: input.currency,
      amount: invoice.amount,
      mint: invoice.mint,
      expected: baseUnits(invoice.amount, invoice.mint),
      expiresAt: invoice.expiresAt,
      productId: invoice.productId,
      apiKey: input.apiKey ?? null,
    },
  });
  runtime.listener.watch(invoice);
  return invoice;
}
