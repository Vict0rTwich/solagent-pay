"use client";

import { Modal } from "@/components/ui/Modal";
import type { Invoice } from "@/lib/types";

import { PaymentPanel } from "./PaymentPanel";

/**
 * Payment view for an existing invoice: QR code, link, "Pay with wallet" and "Cancel payment".
 * Closing it stops this view's chain watch; the invoice stays open and the dashboard keeps checking it.
 */
export function InvoiceModal({ invoice, onClose }: { invoice: Invoice | null; onClose: () => void }) {
  return (
    <Modal
      open={invoice !== null}
      onClose={onClose}
      title={invoice ? `Invoice ${invoice.id}` : "Invoice"}
      description="Share the link or QR code with your client, or pay it from a wallet in this browser."
    >
      {invoice && (
        <div className="mt-6">
          <PaymentPanel invoice={invoice} onDismiss={onClose} onCanceled={onClose} />
        </div>
      )}
    </Modal>
  );
}
