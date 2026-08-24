import { Github } from "@transfergo/ui";

export function Footer() {
  return (
    <footer className="flex items-center justify-center gap-2 border-t border-border px-6 py-8 text-sm text-text-muted">
      <a
        href="https://github.com/Edilson-5762/transfergo"
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1.5 hover:text-text"
      >
        <Github className="size-4" aria-hidden="true" />
        GitHub
      </a>
    </footer>
  );
}
