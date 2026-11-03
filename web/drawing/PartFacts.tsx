// R6: what the panel says about one part, as one block: shown in the code drawer before a run, and under the verdict after one. Every word comes
// from renderer/authors/part-panel.ts, worked out again on every render, so it can't outlive the code or the run it describes.
import type { PartPanel } from "../../renderer/authors/part-panel";

export function PartFacts({ part, className = "c-part", children, actions = null }: { part: PartPanel; className?: string; children?: React.ReactNode; /** R14: "Bet on this part" and "Ask about this part", under the facts. */ actions?: React.ReactNode }) {
  return (
    <>
    <section className={className} aria-live="polite" aria-label={`About ${part.title}`} data-testid="part-panel" data-part={part.id}>
      {children}
      {part.natural && <p className="c-part-ai" data-testid="part-ai">{part.natural}</p>}
      <h2 className={`c-part-title${part.natural ? " c-part-code" : ""}`}>{part.title}</h2>
      {part.name && <p className="c-part-name">{part.name}</p>}
      {part.summary && <p className="c-part-ai c-part-sum" data-testid="part-summary">{part.summary}</p>}
      {part.broke && (
        <div className="c-part-broke" data-testid="part-broke">
          {part.broke.map((w) => (
            <p key={w}>{w}</p>
          ))}
        </div>
      )}
      <ul className="c-part-says">
        {part.says.map((w) => (
          <li key={w}>{w}</li>
        ))}
      </ul>
      {part.note && <p className="c-part-note" data-testid="part-names-note">{part.note}</p>}
    </section>
    {/* Review round 2 minor 5: the controls sit outside the live region, so typing a question is never read out as a panel change. */}
    {actions}
    </>
  );
}
