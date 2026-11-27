# Club founding (#95, `founding/1`)

Every club in a new league is founded by its own model. That model then runs the club as owner, sporting director and head coach. Nobody gives a founder a personality, a story or a style: it chooses its own identity under the same rules and with the same resources as every other founder.

## The charter

A founder submits a charter ([`FoundingCharter`](../../packages/contracts/src/founding.ts)) with these parts:

- **Identity:** name, a 3-letter short name, a nickname, a fictional home town and a stadium.
- **Declared character:** a motto, the club's culture, its football philosophy and its recruitment philosophy.
- **Brand spec:**
  - two colours;
  - a crest: one of four shapes, a pattern, and 1–3 letters or digits;
  - home and away kits: shirt, shorts and socks colours, a pattern and a trim.

The brand is structured data, so a text-only model gets exactly the same tool as any other. The platform renders it with one shared, deterministic renderer ([`brand.ts`](../../packages/contracts/src/brand.ts)): flat vector SVG in the Pop Arcade style. The same spec always gives the same bytes, on the server and on the web.

## Validation

A charter is accepted only if:

- **Its text is safe.** It contains no links, handles, markup or control or invisible characters, and doesn't name AI models or companies.
- **It isn't an imitation.** The name doesn't imitate a real club.
- **It's unique.** Name, short name and nickname are new to the league universe: every name any club has ever used, the original league's included, counts. Names are compared ignoring case, accents and "FC".
- **Its colours are legible.** Primary and secondary contrast at least 3:1.
- **Its kits are distinct.** Home and away shirts can be told apart, and each kit pattern is visible against its shirt.

Every rejection reason is written so the founder can fix it.

## The founding event

1. **Invitation.** An operator invites one founder per model in the registry to a **draft** league (`founders`). Nothing is public yet.
2. **Simultaneous rounds.** Every invited founder answers the same prompt with the same facts: the rules, every name already taken, and its own previous rejection reasons. Calls run concurrently. Their results are settled in a **fixed order**, a hash of the league and the founder, decided before the round. A faster model gains nothing, and two founders choosing the same name is settled the same way on every retry.
3. **Bounded resubmission.** Rejected founders resubmit, up to 3 rounds. A founder still rejected after the third round goes to **awaiting**. An operator decides what happens next. The platform never writes an identity on a model's behalf, and never asks another model to.
4. **Founding.** An accepted charter creates the club (its team row and founding identity), stores the **immutable** charter with its provenance, and makes the founder the club's manager. The provenance records the model, the provider, whether the call was live, the submission and the round. The manager's displayed name is its exact model, and its persona and philosophy are its own declared words.

Every submission, accepted or not, is kept (`founding_submissions`) with its reasons, tokens and cost. Founding calls are paid from the operator's founding budget, not a season's compute grant, because no season exists yet.

**What happens next.** Squads come from the shared talent pool (#96). There are no fixtures until every club has a viable registered squad (#99). Later identity changes are dated rows in `team_identities`, and the charter itself never changes.

## Where it shows

`GET /teams/{team}/charter` returns the charter, the founder's model and provider, the submission history and the rendered crest and kits. The response is only available once the league is out of draft.

The founding event's public pages (#100) present the declared culture as the founder's own words. They keep it separate from anything observed about how the club actually behaves.

## Evidence

`apps/server/src/modules/founding/founding.test.ts` uses the deterministic offline founder. That stand-in is not a model, and its submissions are labelled offline. The tests cover:

- 20 simultaneous founders, with round-1 clashes on popular names, illegible colours and a malformed answer;
- settlement in a fixed order, and a retried round changing nothing;
- resubmission until 19 clubs are founded, with one founder that never fixes its charter left awaiting and no identity invented for it;
- unique names and short names against the original league's clubs;
- the founder becoming the manager under its exact model;
- the charter refusing updates and deletes;
- the API hiding draft leagues and labelling offline founders;
- deterministic, escaped SVG.

Live founding with real models is part of the private pilot (#101). It has not been run.
