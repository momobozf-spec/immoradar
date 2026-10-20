import type { ContactTypeValue } from './normalizeContact'

/**
 * Welke rol een contact tegenover een adres heeft.
 *
 * Alleen rollen waarvan we het zeker weten. Een `PROSPECT` met een adres is niet
 * per se de eigenaar van dat adres — dat kan net zo goed het adres zijn waar hij
 * naartoe wil verhuizen. `INTERESTED` is dan het eerlijke antwoord, en de
 * CRM-matcher telt die rol bewust niet mee als eigendomssignaal.
 */
export function roleForContactType(
  contactType: ContactTypeValue,
): 'OWNER' | 'FORMER_OWNER' | 'BUYER' | 'SELLER' | 'TENANT' | 'VALUATION_SUBJECT' | 'INTERESTED' {
  switch (contactType) {
    case 'SELLER':
      return 'SELLER'
    case 'VALUATION_LEAD':
      return 'VALUATION_SUBJECT'
    case 'FORMER_CLIENT':
      return 'FORMER_OWNER'
    case 'LANDLORD':
      return 'OWNER'
    case 'TENANT':
      return 'TENANT'
    case 'BUYER':
      return 'BUYER'
    case 'PROSPECT':
    case 'UNKNOWN':
      return 'INTERESTED'
  }
}
