import { TRANSFER_STATES } from "@transfergo/shared";

export default function HomePage() {
  return (
    <main>
      <h1>TransferGo</h1>
      <p>Fundação do monorepo funcionando.</p>
      <ul>
        {TRANSFER_STATES.map((state) => (
          <li key={state}>{state}</li>
        ))}
      </ul>
    </main>
  );
}
