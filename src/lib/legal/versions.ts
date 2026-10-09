/**
 * Версии юридических документов (строки-даты). Покупка требует согласия
 * с текущими версиями всех трёх; смена значения означает новые документы —
 * клиент обязан заново прочитать и принять их.
 */
export const TERMS_VERSION = '2026-10-08';
export const REFUNDS_VERSION = '2026-10-08';
export const RULES_VERSION = '2026-10-08';

/** Тело согласия из запроса checkout/create (значения приходят от клиента). */
export interface ConsentBody {
  acceptedTerms?: unknown;
  termsVersion?: unknown;
  refundsVersion?: unknown;
  rulesVersion?: unknown;
}

/** 400 при отсутствии/устаревании согласия: документы изменились, перечитайте. */
export const DOCUMENTS_UPDATED_ERROR =
  'Documents updated — please re-read the terms, refund policy and rules, then accept the current versions.';

/** Согласие действительно, только если принято явно и все три версии — текущие. */
export function consentAccepted(body: ConsentBody): boolean {
  return (
    body.acceptedTerms === true &&
    body.termsVersion === TERMS_VERSION &&
    body.refundsVersion === REFUNDS_VERSION &&
    body.rulesVersion === RULES_VERSION
  );
}
