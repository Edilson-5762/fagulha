"use client";

import { Construction, StateScreen } from "@transfergo/ui";

export default function TransferPlaceholderPage() {
  return (
    <main className="flex min-h-screen items-center justify-center">
      <StateScreen
        icon={Construction}
        title="Em construção"
        description="A criação de sessões de transferência chega em um próximo passo do projeto."
      />
    </main>
  );
}
