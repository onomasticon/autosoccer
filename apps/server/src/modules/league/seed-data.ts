/** The four founding clubs of the league. Fictional; crests are flat vector marks. */
import type { Position } from "@autosoccer/contracts";

export interface SeedTeam {
  slug: string;
  name: string;
  shortName: string;
  city: string;
  colors: { primary: string; secondary: string };
  crest: { shape: "shield" | "circle" | "hexagon" | "diamond"; glyph: string };
  /**
   * Ten players. 7-a-side starters fill GK, DF, DF, MF, MF, MF, FW; shirts 1–7 were the
   * original 5-a-side squad (starters GK, DF, DF, MF, FW and two reserves), 8–10 joined for 7-a-side.
   */
  players: Array<{ name: string; number: number; position: Position }>;
}

const squad = (names: string[]): SeedTeam["players"] => {
  const positions: Position[] = ["GK", "DF", "DF", "MF", "FW", "DF", "FW", "MF", "MF", "FW"];
  return names.map((name, i) => ({ name, number: i + 1, position: positions[i]! }));
};

export const SEED_TEAMS: SeedTeam[] = [
  {
    slug: "harbour-city",
    name: "Harbour City",
    shortName: "HBC",
    city: "Harbour City",
    colors: { primary: "#245EFF", secondary: "#FFFFFF" },
    crest: { shape: "shield", glyph: "H" },
    players: squad([
      "Ada Okafor",
      "Bruno Lind",
      "Chen Wu",
      "Dara Quinn",
      "Eli Moreau",
      "Femi Adeyemi",
      "Gus Varga",
      "Hana Ito",
      "Ivo Brandt",
      "Jae Moon",
    ]),
  },
  {
    slug: "red-rock-rovers",
    name: "Red Rock Rovers",
    shortName: "RRR",
    city: "Red Rock",
    colors: { primary: "#E2412E", secondary: "#FFE7A3" },
    crest: { shape: "circle", glyph: "R" },
    players: squad([
      "Iris Kale",
      "Jon Pike",
      "Kofi Mensah",
      "Lia Sorn",
      "Max Ruiz",
      "Nell Hart",
      "Omar Said",
      "Pablo Reyes",
      "Runa Dahl",
      "Sol Achebe",
    ]),
  },
  {
    slug: "northgate-comets",
    name: "Northgate Comets",
    shortName: "NGC",
    city: "Northgate",
    colors: { primary: "#1F9D74", secondary: "#F5F0E8" },
    crest: { shape: "hexagon", glyph: "N" },
    players: squad([
      "Pia Laine",
      "Quentin Mbeki",
      "Rosa Ibarra",
      "Sami Haddad",
      "Tove Nyberg",
      "Uma Rao",
      "Viktor Hale",
      "Wanda Kerr",
      "Xan Petit",
      "Yusuf Demir",
    ]),
  },
  {
    slug: "saltmarsh-athletic",
    name: "Saltmarsh Athletic",
    shortName: "SMA",
    city: "Saltmarsh",
    colors: { primary: "#F2A93B", secondary: "#20203B" },
    crest: { shape: "diamond", glyph: "S" },
    players: squad([
      "Wen Tao",
      "Xavi Cole",
      "Yara Haddad",
      "Zane Brooks",
      "Abel Novak",
      "Bea Lund",
      "Cyrus Amini",
      "Dina Osei",
      "Emil Strand",
      "Faye Burke",
    ]),
  },
];
