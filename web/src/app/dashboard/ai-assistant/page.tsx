import type { Metadata } from "next";

import { AssistantView } from "@/components/assistant/AssistantView";

export const metadata: Metadata = {
  title: "SolAgent AI assistant",
};

export default function AiAssistantPage() {
  return <AssistantView />;
}
