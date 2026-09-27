import type { ProductInfo } from "./types";

// What a product listing may say, shared by the create form and the payment server so a form never accepts a
// product the server would refuse, or the other way round.

export const PRODUCT_TITLE_MAX = 60;
export const PRODUCT_DESCRIPTION_MAX = 280;
const IMAGE_URL_MAX = 500;

export type ImageCheck = { ok: true; image: string | null } | { ok: false; error: string };

/**
 * Reads an image URL a merchant pasted. Empty is fine (the Blink falls back to the token icon). Otherwise it must be
 * an absolute https URL: Blink clients and X fetch the image from their own servers, and refuse plain http.
 */
export function parseImageUrl(input: string): ImageCheck {
  const raw = input.trim();
  if (!raw) return { ok: true, image: null };
  if (raw.length > IMAGE_URL_MAX) return { ok: false, error: `Image links go up to ${IMAGE_URL_MAX} characters.` };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, error: "Paste a full image link, starting with https://." };
  }
  if (url.protocol !== "https:") return { ok: false, error: "The image link must start with https://, which Blink clients require." };
  if (url.username || url.password) return { ok: false, error: "The image link can't carry a username or password." };
  return { ok: true, image: url.toString() };
}

export type ProductInfoCheck = { ok: true; info: ProductInfo } | { ok: false; field: keyof ProductInfo; error: string };

/** Title, description and image, trimmed and checked. */
export function parseProductInfo(input: { title: unknown; description: unknown; image: unknown }): ProductInfoCheck {
  const title = typeof input.title === "string" ? input.title.trim() : "";
  if (!title) return { ok: false, field: "title", error: "Name the product, as buyers will see it on the Blink card." };
  if (title.length > PRODUCT_TITLE_MAX) return { ok: false, field: "title", error: `Titles go up to ${PRODUCT_TITLE_MAX} characters.` };

  const description = typeof input.description === "string" ? input.description.trim() : "";
  if (description.length > PRODUCT_DESCRIPTION_MAX) {
    return { ok: false, field: "description", error: `Descriptions go up to ${PRODUCT_DESCRIPTION_MAX} characters.` };
  }

  if (input.image !== null && input.image !== undefined && typeof input.image !== "string") {
    return { ok: false, field: "image", error: "image must be an https URL or null." };
  }
  const image = parseImageUrl(typeof input.image === "string" ? input.image : "");
  if (!image.ok) return { ok: false, field: "image", error: image.error };

  return { ok: true, info: { title, description, image: image.image } };
}

/** "Receipt: Solana Hacker Hoodie", cut to fit `max` characters (Underdog's on-chain name holds 32). */
export function receiptName(title: string, max = 32): string {
  const name = `Receipt: ${title}`;
  return name.length <= max ? name : `${name.slice(0, max - 1).trimEnd()}…`;
}
