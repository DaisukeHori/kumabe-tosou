import { getHelpPersona } from "../personas";
import type { HelpPersonaId } from "../types";

/** ユースケースの冒頭に出す人物紹介 (誰の話なのかを先に伝える)。 */
export function PersonaCard({ persona }: { persona: HelpPersonaId }) {
  const p = getHelpPersona(persona);
  return (
    <div className="flex items-start gap-3 rounded-lg border border-border bg-muted p-3" data-help-persona={p.id}>
      <span
        className="flex size-9 shrink-0 items-center justify-center rounded-full bg-foreground text-sm font-extrabold text-white"
        aria-hidden="true"
      >
        {p.name.slice(0, 1)}
      </span>
      <div className="min-w-0 text-sm">
        <p className="font-bold text-foreground">
          {p.name} <span className="font-normal text-muted-foreground">／ {p.role}</span>
        </p>
        <p className="mt-0.5 text-muted-foreground">{p.description}</p>
        <p className="mt-0.5 text-muted-foreground">{p.habit}</p>
      </div>
    </div>
  );
}
