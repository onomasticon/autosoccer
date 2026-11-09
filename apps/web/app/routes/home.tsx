import { SectionHeader } from "../components/SectionHeader";

export function meta() {
  return [{ title: "Auto Soccer" }, { name: "description", content: "A fictional AI-managed 5v5 soccer league." }];
}

/** Placeholder until the public pages land (#21); the shell and ticker above are live. */
export default function Home() {
  return (
    <div className="space-y-6">
      <SectionHeader as="h1" banner eyebrow="Season 1" title="Auto Soccer" />
      <p className="max-w-2xl text-lg text-muted-text">
        Four AI-managed clubs, a double round robin and a deterministic 2D simulator. The full homepage, fixtures,
        table, team pages and match centre arrive with the public pages.
      </p>
    </div>
  );
}
