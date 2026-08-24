import { MousePointerClick, Share2, Wifi } from "@transfergo/ui";

const STEPS = [
  { icon: MousePointerClick, title: "Selecionar", description: "Escolha um ou mais arquivos no seu dispositivo." },
  { icon: Wifi, title: "Conectar", description: "Compartilhe o link seguro com o outro dispositivo." },
  { icon: Share2, title: "Transferir", description: "Os arquivos vão direto de um dispositivo para o outro." }
];

export function HowItWorks() {
  return (
    <section className="px-6 py-16">
      <h2 className="text-center text-2xl font-semibold text-text">Como funciona</h2>
      <div className="mx-auto mt-10 grid max-w-4xl gap-8 sm:grid-cols-3">
        {STEPS.map((step, index) => (
          <div key={step.title} className="flex flex-col items-center text-center">
            <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-bg-elevated text-accent">
              <step.icon className="size-6" aria-hidden="true" />
            </div>
            <h3 className="text-sm font-semibold text-text">
              {index + 1}. {step.title}
            </h3>
            <p className="mt-2 text-sm text-text-muted">{step.description}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
