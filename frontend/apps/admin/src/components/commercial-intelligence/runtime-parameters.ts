import { readPublicEnv } from "@/lib/commercial-intelligence/env";
import { parametersFromEnv } from "@/lib/commercial-intelligence/parameters";

/**
 * The parameters in force on this page: the built-in defaults with the
 * deployment's environment applied, resolved once (the environment cannot
 * change while the page is open) together with what could not be used.
 *
 * There is deliberately no per-viewer override and no `localStorage` here. A
 * value chosen in one browser would make two people receive different
 * recommendations, so nothing that shapes a recommendation is stored on the
 * viewer's side. The official, single, audited home of the business rules is the
 * register of `add-commercial-intelligence-governance`; until it exists the
 * environment's value is the value.
 */
export const RUNTIME_PARAMETERS = parametersFromEnv(readPublicEnv());
