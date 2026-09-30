/**
 * Single place where Fabric's object model is extended with the metadata the
 * bill template needs. Import this exactly once, before any object is created.
 */
import { FabricObject } from "fabric";

/**
 * Custom properties are only serialised when they are registered here.
 * Without this, `id` / `name` / `role` silently vanish from `toObject()`.
 */
export const APP_PROPERTIES = [
  "id",
  "name",
  "role",
  "roleKind",
  "locked",
] as const;

let registered = false;

export function registerAppProperties(): void {
  if (registered) return;
  const target = FabricObject as unknown as { customProperties: string[] };
  target.customProperties = [...(target.customProperties ?? []), ...APP_PROPERTIES];
  registered = true;
}

/** Generate a reasonably unique, human-scannable object id. */
let counter = 0;
export function createId(prefix = "obj"): string {
  counter += 1;
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${counter.toString(36)}${rand}`;
}
