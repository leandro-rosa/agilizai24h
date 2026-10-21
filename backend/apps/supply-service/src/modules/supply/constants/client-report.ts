/**
 * The removal reason a client divergence report covers: the report label "Outro motivo" (`other_reason`).
 *
 * The internal name "Outros (roubo)" is NOT a stored reason: the export only knows "Outro motivo", and the parser
 * rejects any "Roubo" label as unknown. The project already treats `other_reason` as the theft bucket — the supplier
 * closing shows "outro motivo (roubo, por conta do Agiliz)" (suppliers-service `closing-removals.ts`) — so this is the
 * one reason included. Expired, damaged, return, transfer and internal use are never in a client report.
 */
export const CLIENT_REPORT_REASON_KEY = 'other_reason'
