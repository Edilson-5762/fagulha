import { Lock, ShieldCheck, Wifi } from "@transfergo/ui";

const POINTS = [
  {
    icon: Wifi,
    title: "P2P direto",
    description: "Os arquivos trafegam direto entre os dispositivos, sem passar pelo nosso servidor."
  },
  {
    icon: ShieldCheck,
    title: "Zero armazenamento",
    description: "Nenhum arquivo fica salvo nos servidores do TransferGo."
  },
  {
    icon: Lock,
    title: "Criptografado",
    description: "A conexão usa WebRTC com criptografia de transporte (DTLS)."
  }
];

export function TrustSection() {
  return (
    <section className="border-t border-border px-6 py-16">
      <div className="mx-auto grid max-w-4xl gap-8 sm:grid-cols-3">
        {POINTS.map((point) => (
          <div key={point.title} className="rounded-lg border border-border bg-bg-elevated/60 p-6">
            <point.icon className="size-5 text-accent" aria-hidden="true" />
            <h3 className="mt-3 text-sm font-semibold text-text">{point.title}</h3>
            <p className="mt-2 text-sm text-text-muted">{point.description}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
