import type { Metadata } from "next";
import { Suspense } from "react";

import { PosRegister } from "@/components/pos/PosRegister";

export const metadata: Metadata = {
  title: "Point of sale",
};

// The register reads ?product= (a product to have ready), which needs a Suspense boundary to prerender.
export default function PosPage() {
  return (
    <Suspense>
      <PosRegister />
    </Suspense>
  );
}
