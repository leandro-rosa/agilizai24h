/**
 * The commercial-intelligence engine: pure functions over the data the page
 * already loads. See the change `add-commercial-intelligence-page` (design.md)
 * for the rules; every threshold is read from `CommercialParameters`.
 *
 * `env.ts` is deliberately not re-exported here: it reads the environment, and
 * this barrel stays importable by plain Node.
 */
export * from "./types";
export * from "./parameters";
export * from "./parameter-docs";
export * from "./logic-version";
export * from "./availability";
export * from "./confidence";
export * from "./synthetic";
export * from "./dataset";
export * from "./kpis";
export * from "./loss-index";
export * from "./quality";
