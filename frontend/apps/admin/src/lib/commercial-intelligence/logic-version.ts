/**
 * The version of the analytic logic (design D22). Every recommendation carries
 * it, together with the parameter values in force, so that a later change of
 * logic or of parameters never rewrites what an earlier recommendation was based
 * on. It says "provisional" until the calibration of tasks group 5 is approved.
 *
 * Change it when the RULES change (a classification, a detector, the confidence
 * rubric, the ranking), not when a parameter value changes: the values travel
 * with each recommendation on their own.
 */
export const LOGIC_VERSION = "ci-logic/0.1.0-provisional";
