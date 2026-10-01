/**
 * Centralized Turkish mobile phone normalization and validation.
 *
 * Accepts common input formats and converts them to the single canonical
 * form +905XXXXXXXXX. Returns null for anything that is not a valid
 * Turkish mobile number.
 */

const TR_MOBILE_PREFIXES = ['5'];

/**
 * Normalize a user-entered phone string to +905XXXXXXXXX.
 *
 * Returns null when the input cannot be interpreted as a valid
 * Turkish mobile number.
 */
export function normalizeTRPhone(input: string): string | null {
  if (!input) return null;

  // Strip everything that isn't a digit or leading +
  let cleaned = input.trim();

  // Remove spaces, dashes, parentheses, dots — visual separators
  cleaned = cleaned.replace(/[\s\-().]/g, '');

  // Extract leading + if present
  const hasPlus = cleaned.startsWith('+');
  if (hasPlus) cleaned = cleaned.slice(1);

  // Now cleaned should be digits only
  if (!/^\d+$/.test(cleaned)) return null;

  // Remove leading country code or trunk prefix to get the bare national number
  let national = cleaned;

  if (national.startsWith('90')) {
    national = national.slice(2);
  } else if (national.startsWith('0')) {
    national = national.slice(1);
  }

  // Turkish mobile numbers are 10 digits: 5XX XXX XX XX
  if (national.length !== 10) return null;

  // Must start with 5 (Turkish mobile)
  if (!TR_MOBILE_PREFIXES.includes(national[0])) return null;

  return '+90' + national;
}

/**
 * Validate a user-entered phone string.
 * Returns true when the input can be normalized to a valid TR mobile number.
 */
export function isValidTRPhone(input: string): boolean {
  return normalizeTRPhone(input) !== null;
}
