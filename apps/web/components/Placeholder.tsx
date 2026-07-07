interface PlaceholderProps {
  title: string;
  description: string;
  /** "design-pending" tag text; omitted for the neutral /present stage. */
  tag?: string;
}

/**
 * Presentational M0 placeholder for a surface. Pure/stateless — the real design drops in later
 * (from the user's Claude Design work). Carries no copilot vocabulary of its own; callers supply strings.
 */
export function Placeholder({ title, description, tag }: PlaceholderProps) {
  return (
    <main className="mc-placeholder">
      <h1>{title}</h1>
      <p>{description}</p>
      {tag ? <span className="mc-tag">{tag}</span> : null}
    </main>
  );
}
