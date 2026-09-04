import Link from "next/link";
import { Button } from "@transfergo/ui";

export function Hero() {
  return (
    <section className="flex flex-col items-center px-6 py-24 text-center">
      <span className="mb-4 text-sm font-medium uppercase tracking-widest text-text-muted">
        TransferGo
      </span>
      <h1 className="max-w-2xl text-4xl font-bold leading-tight text-text sm:text-5xl">
        Transfira arquivos com segurança entre seus dispositivos.
      </h1>
      <p className="mt-4 max-w-xl text-text-muted">
        Conexão direta entre seus aparelhos, sem armazenar nada nos nossos servidores.
      </p>
      <Button asChild size="lg" className="mt-8">
        <Link href="/transferir">Nova transferência</Link>
      </Button>
      <p className="mt-4 text-xs uppercase tracking-widest text-text-muted">
        Rápido • Seguro • Direto
      </p>
    </section>
  );
}
