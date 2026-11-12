import { normalizeProfile } from './household.mjs';

// Browsers without Intl.supportedValuesOf (Safari before 15.4) get a short list instead of a module that
// throws on import and takes both features down with it.
export const FALLBACK_CURRENCIES = Object.freeze(['AUD', 'BRL', 'CAD', 'CHF', 'CNY', 'CZK', 'DKK', 'EUR', 'GBP', 'HKD',
  'HUF', 'INR', 'ISK', 'JPY', 'KRW', 'MXN', 'NOK', 'NZD', 'PLN', 'SEK', 'SGD', 'THB', 'TRY', 'USD', 'ZAR']);
// ISO 4217 codes that are not money anyone shops with: precious metals, bond units, testing and "no currency".
export const NON_MONEY = Object.freeze(['XAG', 'XAU', 'XBA', 'XBB', 'XBC', 'XBD', 'XDR', 'XPD', 'XPT', 'XSU', 'XTS', 'XUA', 'XXX']);

/** The currencies the budget accepts, from the runtime's list (or the fallback), without NON_MONEY. */
export function currencyList(intl = Intl) {
  let codes;
  try {
    codes = intl.supportedValuesOf('currency');
  } catch {
    codes = FALLBACK_CURRENCIES;
  }
  return new Set([...codes].filter((c) => !NON_MONEY.includes(c)));
}

const CURRENCIES = currencyList();
const object = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
export const isCurrency = (v) => typeof v === 'string' && CURRENCIES.has(v);

// Formatters are expensive to build and a render validates and formats every shop several times
// (up to 10,000 of them), so they are made once per currency and locale.
const DIGITS = new Map();
const FORMATTERS = new Map();
const formatter = (locale, options) => {
  const key = `${locale}\u0000${JSON.stringify(options)}`;
  if (!FORMATTERS.has(key)) FORMATTERS.set(key, new Intl.NumberFormat(locale, options));
  return FORMATTERS.get(key);
};

export function currencyDigits(currency) {
  if (!isCurrency(currency)) throw new RangeError('Use a supported ISO 4217 currency code');
  if (!DIGITS.has(currency)) DIGITS.set(currency, formatter('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits);
  return DIGITS.get(currency);
}

/** Decimal major units to integer minor units, half-up. No binary float multiplication. */
export function toMinor(amount, currency) {
  const digits = currencyDigits(currency);
  if (!['number', 'string'].includes(typeof amount) || (typeof amount === 'number' && !Number.isFinite(amount))) {
    throw new RangeError('Amount must be a non-negative decimal');
  }
  const match = String(amount).match(/^(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:e([+-]?\d+))?$/i);
  if (!match || String(amount).length > 100) throw new RangeError('Amount must be a non-negative decimal');
  const exponent = Number(match[4] ?? 0);
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 100) throw new RangeError('Amount is too large or too small');
  const fraction = match[2] ?? match[3] ?? '';
  const places = fraction.length - exponent;
  const whole = BigInt((match[1] ?? '0') + fraction);
  const shift = digits - places;
  const divisor = shift < 0 ? 10n ** BigInt(-shift) : 1n;
  const minor = shift >= 0 ? whole * 10n ** BigInt(shift) : (whole + divisor / 2n) / divisor;
  if (minor > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError('Amount exceeds safe minor-unit range');
  return Number(minor);
}

export function formatMoney(minor, currency, locale = 'en') {
  if (!Number.isSafeInteger(minor)) throw new RangeError('Money must be integer minor units');
  const digits = currencyDigits(currency);
  // Format the integer and replace its fractional part to preserve every minor unit.
  const absolute = BigInt(Math.abs(minor));
  const scale = 10n ** BigInt(digits);
  const major = absolute / scale;
  const money = formatter(locale, { style: 'currency', currency });
  const parts = money.formatToParts(minor < 0 ? -major : major);
  const fraction = (absolute % scale).toString().padStart(digits, '0');
  // Negative amounts below one major unit need -0 to retain their sign.
  const signedParts = minor < 0 && major === 0n ? money.formatToParts(-0) : parts;
  const localizedFraction = formatter(locale, { useGrouping: false, minimumIntegerDigits: Math.max(1, digits) }).format(Number(fraction));
  return signedParts.map((p) => p.type === 'fraction' ? localizedFraction : p.value).join('');
}

function validAmount(value, currency) {
  try { toMinor(value, currency); return true; } catch { return false; }
}
export function validateBudget(b) {
  if (!object(b)) return ['budget must be an object'];
  const errors = [];
  if (!['week', 'month'].includes(b.period)) errors.push('period must be week or month');
  if (!isCurrency(b.currency)) errors.push('currency must be a supported ISO 4217 code');
  if (!validAmount(b.amount, b.currency)) errors.push('amount must be a non-negative decimal within the safe minor-unit range');
  return errors;
}
export function isDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000-')) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function validateShop(s) {
  if (!object(s)) return ['shop must be an object'];
  const errors = [];
  if (!isDate(s.date)) errors.push('date must be a real YYYY-MM-DD calendar date');
  if (!isCurrency(s.currency)) errors.push('currency must be a supported ISO 4217 code');
  if (!validAmount(s.total, s.currency)) errors.push('total must be a non-negative decimal within the safe minor-unit range');
  if (s.meals !== undefined && (!Number.isSafeInteger(s.meals) || s.meals < 1)) errors.push('meals must be a positive safe integer');
  if (s.note !== undefined && (typeof s.note !== 'string' || s.note.length > 200 || /[\r\n\u0000-\u001f]/.test(s.note))) {
    errors.push('note must be a single line of at most 200 characters');
  }
  return errors;
}
const dayString = (d) => {
  // Expanded ISO years cannot be compared with YYYY-MM-DD ledger dates.
  if (d.getUTCFullYear() < 1 || d.getUTCFullYear() > 9999) {
    throw new RangeError('Period dates must stay within years 0001–9999');
  }
  return d.toISOString().slice(0, 10);
};
// The local calendar date, as lib/draft.mjs today() writes shop dates: dayString would give the UTC date.
const localDay = (d) => dayString(new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())));
const shiftDays = (date, n) => { const d = new Date(date); d.setUTCDate(d.getUTCDate() + n); return d; };

/** Inclusive start/end dates. ISO weeks use the Thursday's year, Monday first. */
export function periodOf(date, period) {
  if (!isDate(date)) throw new RangeError('date must be a real YYYY-MM-DD calendar date');
  if (!['week', 'month'].includes(period)) throw new RangeError('period must be week or month');
  const d = new Date(`${date}T00:00:00Z`);
  if (period === 'month') {
    const start = new Date(d); start.setUTCDate(1);
    const end = new Date(start); end.setUTCMonth(end.getUTCMonth() + 1); end.setUTCDate(0);
    return { key: date.slice(0, 7), start: dayString(start), end: dayString(end) };
  }
  const start = shiftDays(d, -((d.getUTCDay() + 6) % 7));
  const thursday = shiftDays(start, 3);
  const year = thursday.getUTCFullYear();
  const jan4 = new Date(0); jan4.setUTCFullYear(year, 0, 4); jan4.setUTCHours(0, 0, 0, 0);
  const firstMonday = shiftDays(jan4, -((jan4.getUTCDay() + 6) % 7));
  const week = Math.round((start - firstMonday) / 604800000) + 1;
  return { key: `${String(year).padStart(4, '0')}-W${String(week).padStart(2, '0')}`, start: dayString(start), end: dayString(shiftDays(start, 6)) };
}
function safeAdd(a, b) {
  if (!Number.isSafeInteger(a + b)) throw new RangeError('Combined amounts exceed safe integer range');
  return a + b;
}
const divide = (amount, count) => Number((BigInt(amount) + BigInt(count) / 2n) / BigInt(count));

/** Current period and chronological history (including current); foreign currencies stay separate.
 * Per-meal spend uses only shops with explicit meals; per-person uses actual head count.
 * Historical budgets/person counts use the current settings, not inferred past profiles.
 */
export function summary(budget, shops, { household, today = localDay(new Date()), periods = 8 } = {}) {
  const errors = validateBudget(budget);
  if (errors.length) throw new RangeError(errors.join('; '));
  if (!Array.isArray(shops)) throw new TypeError('shops must be an array');
  if (!Number.isInteger(periods) || periods < 1 || periods > 52) throw new RangeError('periods must be from 1 to 52');
  const amountMinor = toMinor(budget.amount, budget.currency);
  const invalidShops = [];
  const valid = shops.filter((s, index) => {
    const problems = validateShop(s);
    if (problems.length) invalidShops.push({ index, problems });
    return !problems.length;
  });
  const people = household == null ? null : Object.values(normalizeProfile(household).people).reduce((a, b) => a + b, 0);
  let period = periodOf(today, budget.period);
  const history = [];
  for (let i = 0; i < periods; i++) {
    let spendMinor = 0, mealSpendMinor = 0, meals = 0, shopCount = 0;
    const foreign = new Map();
    for (const s of valid) {
      if (s.date < period.start || s.date > period.end) continue;
      const minor = toMinor(s.total, s.currency);
      if (s.currency !== budget.currency) {
        const entry = foreign.get(s.currency) ?? { currency: s.currency, spendMinor: 0, shopCount: 0 };
        entry.spendMinor = safeAdd(entry.spendMinor, minor); entry.shopCount++;
        foreign.set(s.currency, entry); continue;
      }
      spendMinor = safeAdd(spendMinor, minor); shopCount++;
      if (s.meals !== undefined) { meals = safeAdd(meals, s.meals); mealSpendMinor = safeAdd(mealSpendMinor, minor); }
    }
    history.unshift({ ...period, currency: budget.currency, amountMinor, spendMinor,
      remainingMinor: safeAdd(amountMinor, -spendMinor), shopCount, meals, mealSpendMinor,
      perMealMinor: meals ? divide(mealSpendMinor, meals) : null,
      perPersonMinor: people && shopCount ? divide(spendMinor, people) : null,
      otherCurrencies: [...foreign.values()].sort((a, b) => a.currency.localeCompare(b.currency)),
    });
    if (i < periods - 1) period = periodOf(dayString(shiftDays(new Date(`${period.start}T00:00:00Z`), -1)), budget.period);
  }
  return { ...history.at(-1), people, invalidShops, history };
}

const CSV_HEADER = ['date', 'total', 'currency', 'meals', 'note'];
// A cell starting with =, + , - or @ is a formula when the file is opened in a spreadsheet. The export puts
// one ' in front of such a note (after any quotes it already starts with), and the import takes it off again,
// so notes survive a round trip unchanged.
const FORMULA_NOTE = /^'*[=+\-@]/;
/** CSV preserves decimal inputs and notes. No network or file access. */
export function exportShopsCsv(shops) {
  if (!Array.isArray(shops)) throw new TypeError('shops must be an array');
  const quote = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  const rows = shops.map((shop, index) => {
    const problems = validateShop(shop);
    if (problems.length) throw new RangeError(`CSV row ${index + 2}: ${problems.join('; ')}`);
    return CSV_HEADER.map((key) => quote(key === 'note' && FORMULA_NOTE.test(shop.note ?? '') ? `'${shop.note}` : shop[key])).join(',');
  });
  return [CSV_HEADER.join(','), ...rows].join('\r\n') + '\r\n';
}

/**
 * Strict header, quoted commas/quotes and CRLF/LF. Invalid input rejects the whole import; blank lines are skipped.
 * A note written as '=… (one quote, then any quotes and a formula character) loses that first quote, which the
 * export added; other notes are imported literally.
 */
export function importShopsCsv(text) {
  if (typeof text !== 'string' || text.length > 1_000_000) throw new RangeError('CSV must be text of at most 1,000,000 characters');
  text = text.replace(/^\uFEFF/, '');
  const rows = [];
  let row = [], value = '', quoted = false, closed = false, started = false;
  const cell = () => { row.push(value); value = ''; quoted = false; closed = false; started = false; };
  const line = () => { cell(); rows.push(row); row = []; if (rows.length > 10_001) throw new RangeError('CSV supports at most 10,000 shops per import'); };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { value += '"'; i++; }
        else { quoted = false; closed = true; }
      } else value += c;
    } else if (c === ',') cell();
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      line();
    } else if (c === '"' && !started && !closed) { quoted = true; started = true; }
    else {
      if (closed || c === '"') throw new RangeError(`CSV row ${rows.length + 1}: malformed quoting`);
      value += c; started = true;
    }
  }
  if (quoted) throw new RangeError('CSV has an unclosed quoted field');
  if (started || closed || row.length || value) line();
  if (rows.length === 0 || rows[0].join(',') !== CSV_HEADER.join(',') || rows[0].length !== CSV_HEADER.length) {
    throw new RangeError(`CSV header must be ${CSV_HEADER.join(',')}`);
  }
  // A fully empty line (a blank line in a hand-edited file, or one at the end) is skipped; row numbers
  // in error messages still count it, so they match the file.
  return rows.slice(1).flatMap((row, index) => (row.length === 1 && row[0] === '' ? [] : [[row, index]])).map(([row, index]) => {
    if (row.length !== CSV_HEADER.length) throw new RangeError(`CSV row ${index + 2}: expected five columns`);
    const shop = { date: row[0], total: row[1], currency: row[2],
      ...(row[3] !== '' ? { meals: /^\d+$/.test(row[3]) ? Number(row[3]) : NaN } : {}),
      ...(row[4] !== '' ? { note: /^'+[=+\-@]/.test(row[4]) ? row[4].slice(1) : row[4] } : {}),
    };
    const problems = validateShop(shop);
    if (problems.length) throw new RangeError(`CSV row ${index + 2}: ${problems.join('; ')}`);
    return shop;
  });
}
