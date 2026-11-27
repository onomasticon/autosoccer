import type { CharterResponse } from "@autosoccer/contracts";
import { SectionHeader } from "./SectionHeader";

/** The platform's own renderer output (escaped, deterministic SVG from a structured spec). */
function Svg({ svg, width, height }: { svg: string; width: number; height: number }) {
  // The renderer's SVG has only a viewBox: give it an explicit box so it never collapses or balloons.
  const sized = svg.replace("<svg ", `<svg width="${width}" height="${height}" `);
  // biome-ignore lint/security/noDangerouslySetInnerHtml: SVG comes from the shared brand renderer, which escapes all text
  return <span className="block shrink-0" style={{ width, height }} dangerouslySetInnerHTML={{ __html: sized }} />;
}

/**
 * A model-founded club's charter: its own declared identity, kept apart from anything observed
 * later. Says exactly which model founded it, and whether the founding was a live model call.
 */
export function FoundingCharter({ charter }: { charter: CharterResponse }) {
  const c = charter.charter;
  const rounds = charter.submissions.length;
  return (
    <section aria-labelledby="charter" className="space-y-3">
      <SectionHeader id="charter" title="Founding charter" />
      <div className="card-surface space-y-4 p-5">
        <div className="flex flex-wrap items-end gap-3">
          <Svg svg={charter.assets.crestSvg} width={88} height={88} />
          <Svg svg={charter.assets.homeKitSvg} width={72} height={86} />
          <Svg svg={charter.assets.awayKitSvg} width={72} height={86} />
        </div>
        <div className="min-w-0 space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-text">
            Founded{" "}
            {new Date(charter.foundedAt).toLocaleDateString("en-GB", {
              day: "numeric",
              month: "long",
              year: "numeric",
              timeZone: "UTC",
            })}{" "}
            by <span className="break-all font-mono normal-case tracking-normal">{charter.founder.model}</span>
            {!charter.founder.live && " · offline stand-in, not a model"}
          </p>
          <p className="font-display text-2xl font-extrabold uppercase italic leading-tight">
            {c.name} <span className="text-muted-text">({c.shortName})</span> · “{c.motto}”
          </p>
          <dl className="grid gap-x-6 gap-y-2 text-sm">
            <div>
              <dt className="font-semibold">Nickname</dt>
              <dd>{c.nickname}</dd>
            </div>
            <div>
              <dt className="font-semibold">Home</dt>
              <dd>
                {c.stadium}, {c.city}
              </dd>
            </div>
          </dl>
          <figure className="space-y-2 border-l-4 border-violet pl-3 text-sm">
            <figcaption className="text-xs font-semibold uppercase tracking-wider text-muted-text">
              In the founder's own words (declared, not observed)
            </figcaption>
            <p>
              <span className="font-semibold">Culture: </span>
              {c.culture}
            </p>
            <p>
              <span className="font-semibold">How we play: </span>
              {c.philosophy}
            </p>
            <p>
              <span className="font-semibold">How we recruit: </span>
              {c.recruitment}
            </p>
          </figure>
          <p className="text-xs text-muted-text">
            {rounds === 1
              ? "Accepted at the first submission."
              : `Accepted at submission ${rounds}; earlier ones were returned with reasons.`}
          </p>
        </div>
      </div>
    </section>
  );
}
