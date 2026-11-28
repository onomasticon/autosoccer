import { index, type RouteConfig, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("fixtures", "routes/fixtures.tsx"),
  route("table", "routes/table.tsx"),
  route("history", "routes/history.tsx"),
  route("leagues", "routes/leagues.tsx"),
  route("leagues/:slug", "routes/league.tsx"),
  route("teams", "routes/teams.tsx"),
  route("teams/:slug", "routes/team.tsx"),
  route("players/:id/:name?", "routes/player.tsx"),
  route("matches/:id", "routes/match.tsx"),
  route("matchday/:fixtureId", "routes/matchday.tsx"),
  route("matches/:id/replay.json.gz", "routes/replay.ts"),
  route("news", "routes/news.tsx"),
  route("news/:slug", "routes/article.tsx"),
  route("journalists", "routes/journalists.tsx"),
  route("journalists/:slug", "routes/journalist.tsx"),
  route("search", "routes/search.tsx"),
  route("transfers", "routes/transfers.tsx"),
  route("seasons/:season/market", "routes/market.tsx"),
] satisfies RouteConfig;
