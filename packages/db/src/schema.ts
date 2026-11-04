import { integer, pgTable, real, text, timestamp, uuid } from "drizzle-orm/pg-core";

// Better Auth tabloları dashboard adımında gelir; `owner_id` için yabancı anahtar o zaman eklenir.
export const project = pgTable("project", {
  id: uuid().primaryKey().defaultRandom(),
  ownerId: text("owner_id").notNull(),
  name: text().notNull(),
  allowedOrigins: text("allowed_origins").array().notNull().default([]),
  sampleRate: real("sample_rate").notNull().default(1),
  retentionDays: integer("retention_days").notNull().default(90),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Public key zaten tarayıcıda görünür; düz metin saklanır. */
export const publicKey = pgTable("public_key", {
  id: uuid().primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => project.id, { onDelete: "cascade" }),
  key: text().notNull().unique(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});
