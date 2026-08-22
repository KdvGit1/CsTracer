import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const tracerProfiles = sqliteTable("tracer_profiles", {
  ownerId: text("owner_id").primaryKey(),
  steamId: text("steam_id").notNull(),
  playerName: text("player_name").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const tracerMatchSummaries = sqliteTable("tracer_match_summaries", {
  ownerId: text("owner_id").notNull(),
  matchId: text("match_id").notNull(),
  matchDate: integer("match_date").notNull(),
  fileName: text("file_name").notNull(),
  mapName: text("map_name").notNull(),
  playerSteamId: text("player_steam_id").notNull(),
  playerName: text("player_name").notNull(),
  summaryJson: text("summary_json").notNull(),
  createdAt: integer("created_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.ownerId, table.matchId] }),
  index("idx_tracer_match_owner_date").on(table.ownerId, table.matchDate),
]);
