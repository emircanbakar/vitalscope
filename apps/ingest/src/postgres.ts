import { project, publicKey } from "@vitalscope/db";
import { and, eq, isNull } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { ResolveKey } from "./types.js";

/** İptal edilmiş anahtar ve silinmiş proje bulunamamış gibi davranır. */
export function createKeyResolver(db: NodePgDatabase): ResolveKey {
  return async (key) => {
    const [row] = await db
      .select({ id: project.id, allowedOrigins: project.allowedOrigins })
      .from(publicKey)
      .innerJoin(project, eq(publicKey.projectId, project.id))
      .where(and(eq(publicKey.key, key), isNull(publicKey.revokedAt)))
      .limit(1);
    return row ?? null;
  };
}
