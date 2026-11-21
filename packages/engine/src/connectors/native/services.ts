import { telegram } from "./telegram";
import type { NativeService } from "./types";
import { x } from "./x";

/** The connectors of our own (ADR 0170), by catalog id: each entry is `native` in `CONNECTOR_CATALOG`. */
export const NATIVE_SERVICES: Record<string, NativeService> = { telegram, x };
