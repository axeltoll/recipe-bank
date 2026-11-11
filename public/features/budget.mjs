import { validateBudget, validateShop, summary, formatMoney, isDate, toMinor, exportShopsCsv, importShopsCsv } from '../../lib/budget.mjs';
import { normalizeProfile, defaultProfile } from '../../lib/household.mjs';
import { esc, selected, field, numberField, storageFor, readStored, writeStored, emit, renderNotice, localToday } from './shared.mjs';
import { HOUSEHOLD_KEY } from './household.mjs';

export const BUDGET_KEY = 'recipe-bank:budget';
export const defaultBudget = () => ({ period: 'week', amount: '0', currency: 'SEK' });
const cleanBudget = (b) => ({ period: b.period, amount: b.amount, currency: b.currency });
const cleanShop = (s) => ({ date: s.date, total: s.total, currency: s.currency,
  ...(s.meals !== undefined ? { meals: s.meals } : {}), ...(s.note !== undefined ? { note: s.note } : {}) });

/** The table remains the exact-value, non-graphical alternative. */
export function renderSpendChart(history, { locale = 'en' } = {}) {
  if (!history.length) return '';
  const max = Math.max(1, ...history.map((p) => p.spendMinor));
  const height = history.length * 40 + 12;
  return `<svg class="rb-budget-chart" viewBox="0 0 600 ${esc(height)}" role="img" aria-label="Spend by period; exact amounts are in the table below">
    <title>Spend by period</title>
    ${history.map((p, i) => `<g><text x="0" y="${esc(i * 40 + 25)}">${esc(p.key)}</text>
      <rect x="140" y="${esc(i * 40 + 8)}" width="${esc(Math.round(p.spendMinor / max * 260))}" height="24"><title>${esc(p.key)}: ${esc(formatMoney(p.spendMinor, p.currency, locale))}</title></rect>
      <text x="420" y="${esc(i * 40 + 25)}">${esc(formatMoney(p.spendMinor, p.currency, locale))}</text></g>`).join('')}
  </svg>`;
}

export function renderBudget(budget, shops, { household, today = localToday(), locale = 'en', message = 'Saved only on this device.', errors = [] } = {}) {
  let report;
  try { report = summary(budget, shops, { household, today }); }
  catch (error) { errors = [...errors, error.message]; }
  const money = (minor, currency = budget.currency) => esc(formatMoney(minor, currency, locale));
  return `<section class="rb-budget" aria-label="Food budget">
    <h2>Food budget</h2><p>Record actual shops. Currency totals are never converted.</p>
    ${renderNotice(message, errors)}
    <form data-rb-form="budget"><fieldset><legend>Budget settings</legend><div class="rb-budget-grid">
      <label>Period<select name="period"><option value="week"${selected(budget.period, 'week')}>Week (Monday–Sunday)</option><option value="month"${selected(budget.period, 'month')}>Calendar month</option></select></label>
      <label>Amount<input name="amount" type="number" min="0" step="any" required value="${esc(budget.amount)}"></label>
      <label>Currency (ISO code)<input name="currency" pattern="[A-Z]{3}" maxlength="3" required value="${esc(budget.currency)}"></label>
      </div><button type="submit">Save budget</button></fieldset></form>
    ${report ? `<h3>${esc(report.key)} · ${esc(report.start)} to ${esc(report.end)}</h3>
      <dl class="rb-budget-totals"><div><dt>Spent</dt><dd>${money(report.spendMinor)}</dd></div>
      <div><dt>${report.remainingMinor < 0 ? 'Over budget' : 'Remaining'}</dt><dd>${money(Math.abs(report.remainingMinor))}</dd></div>
      <div><dt>Per recorded meal</dt><dd>${report.perMealMinor == null ? 'Not enough data' : money(report.perMealMinor)}</dd></div>
      <div><dt>Per person</dt><dd>${report.perPersonMinor == null ? 'Not enough data' : money(report.perPersonMinor)}</dd></div></dl>
      <p>Per-meal cost uses only shops with a meal count (${esc(report.meals)} meals recorded). Per-person cost uses actual people in the current household.</p>
      ${report.otherCurrencies.length ? `<p class="rb-budget-warning" role="status">Other currencies excluded from the budget: ${report.otherCurrencies.map((c) => money(c.spendMinor, c.currency)).join('; ')}.</p>` : ''}
      <h3>Spend over time</h3>
      ${renderSpendChart(report.history, { locale })}
      <div class="rb-budget-scroll"><table><caption>Current settings applied to the last ${esc(report.history.length)} periods</caption>
      <thead><tr><th scope="col">Period</th><th scope="col">Spent</th><th scope="col">Per meal</th><th scope="col">Per person</th><th scope="col">Other currencies</th></tr></thead>
      <tbody>${report.history.map((p) => `<tr><th scope="row">${esc(p.key)}</th><td>${money(p.spendMinor)}</td><td>${p.perMealMinor == null ? '—' : money(p.perMealMinor)}</td><td>${p.perPersonMinor == null ? '—' : money(p.perPersonMinor)}</td><td>${p.otherCurrencies.length ? p.otherCurrencies.map((c) => money(c.spendMinor, c.currency)).join('; ') : '—'}</td></tr>`).join('')}</tbody></table></div>` : ''}
    <form data-rb-form="shop"><fieldset><legend>Record a shop</legend><div class="rb-budget-grid">
      <label>Date<input name="date" type="date" required value="${esc(today)}"></label>
      <label>Total<input name="total" type="number" min="0" step="any" required></label>
      <label>Currency (ISO code)<input name="currency" pattern="[A-Z]{3}" maxlength="3" required value="${esc(budget.currency)}"></label>
      <label>Meals covered (optional)<input name="meals" type="number" min="1" step="1"></label>
      <label>Short note (optional)<input name="note" maxlength="200"></label>
      </div><button type="submit">Add shop</button></fieldset></form>
    <h3>Recorded shops</h3><ul class="rb-budget-shops">${shops.length ? shops.map((s, index) =>
      `<li><span>${esc(s?.date)} · ${moneyFromShop(s, locale)}${s?.meals === undefined ? '' : ` · ${esc(s.meals)} meals`}${s?.note ? ` · ${esc(s.note)}` : ''}</span> <button type="button" data-rb-remove="${esc(index)}" aria-label="Remove shop ${esc(index + 1)} from ${esc(s?.date)}">Remove</button></li>`).join('') : '<li>No shops recorded yet.</li>'}</ul>
    <details><summary>Export or import shops (CSV)</summary>
      <p>Copy the export as a local backup. Imports append all rows, including duplicates. Check before importing the same file twice.</p>
      <label>CSV export<textarea readonly rows="5" aria-label="Recorded shops CSV export">${esc(exportShopsCsv(shops.filter((s) => !validateShop(s).length)))}</textarea></label>
      <form data-rb-form="shops-csv"><label>Paste CSV to import<textarea name="csv" rows="5" required maxlength="1000000" placeholder="date,total,currency,meals,note"></textarea></label><button type="submit">Import shops</button></form>
    </details>
  </section>`;
}
function moneyFromShop(s, locale) {
  // Summary handles validation; the ledger still renders removable corrupt records safely.
  try {
    if (validateShop(s).length) return 'Invalid shop';
    return esc(formatMoney(toMinor(s.total, s.currency), s.currency, locale));
  } catch { return 'Invalid shop'; }
}

export function mount(element, options = {}) {
  const storage = storageFor(options);
  const stored = readStored(storage, BUDGET_KEY, { budget: defaultBudget(), shops: [] });
  const input = stored.value;
  let budget = validateBudget(input?.budget).length ? defaultBudget() : cleanBudget(input.budget);
  let shops = Array.isArray(input?.shops) ? input.shops.filter((s) => !validateShop(s).length).map(cleanShop) : [];
  let household = normalizeProfile(options.household ?? readStored(storage, HOUSEHOLD_KEY, defaultProfile()).value);
  let available = stored.available;
  const repaired = validateBudget(input?.budget).length || !Array.isArray(input?.shops) || shops.length !== input.shops.length;
  let message = repaired ? 'Some saved data was invalid and was skipped. Review your settings before saving.' : '';
  const today = isDate(options.today) ? options.today : localToday();
  const render = () => {
    element.innerHTML = renderBudget(budget, shops, { household, today, locale: options.locale,
      message: message || (available ? 'Saved only on this device when you press Save or add a shop.' : 'Storage unavailable or unreadable. Changes work for this visit only.') });
  };
  const changed = () => {
    available = writeStored(storage, BUDGET_KEY, { budget, shops });
    message = available ? 'Saved on this device.' : '';
    render();
    let report = null;
    try { report = summary(budget, shops, { household, today }); } catch { /* The rendered error explains overflow. */ }
    emit(element, 'recipe-bank:budget-change', { budget: cleanBudget(budget), shops: shops.map(cleanShop), summary: report });
  };
  const submit = (event) => {
    const kind = event.target.dataset.rbForm;
    if (!['budget', 'shop', 'shops-csv'].includes(kind)) return;
    event.preventDefault();
    const form = event.target;
    if (kind === 'shops-csv') {
      try {
        const imported = importShopsCsv(field(form, 'csv'));
        shops.push(...imported.map(cleanShop)); changed();
      } catch (error) {
        const status = element.querySelector('.rb-feature-status');
        status.textContent = error.message; status.setAttribute('role', 'alert');
      }
      return;
    }
    const next = kind === 'budget' ? { period: field(form, 'period'), amount: field(form, 'amount'), currency: field(form, 'currency').trim().toUpperCase() } : {
      date: field(form, 'date'), total: field(form, 'total'), currency: field(form, 'currency').trim().toUpperCase(),
      ...(field(form, 'meals') !== '' ? { meals: numberField(form, 'meals') } : {}),
      ...(field(form, 'note') !== '' ? { note: field(form, 'note') } : {}),
    };
    const errors = kind === 'budget' ? validateBudget(next) : validateShop(next);
    if (errors.length) {
      const status = element.querySelector('.rb-feature-status');
      status.textContent = errors.join('; '); status.setAttribute('role', 'alert'); return;
    }
    if (kind === 'budget') budget = cleanBudget(next); else shops.push(cleanShop(next));
    changed();
  };
  const click = (event) => {
    const button = event.target.closest?.('[data-rb-remove]');
    if (!button || !element.contains(button)) return;
    const index = Number(button.dataset.rbRemove);
    if (!Number.isInteger(index) || index < 0 || index >= shops.length) return;
    shops.splice(index, 1); changed();
  };
  const setHousehold = (profile) => { household = normalizeProfile(profile); render(); };
  const householdChange = (event) => setHousehold(event.detail.profile);
  element.addEventListener('submit', submit); element.addEventListener('click', click);
  options.householdElement?.addEventListener('recipe-bank:household-change', householdChange);
  render();
  return { setHousehold, destroy() {
    element.removeEventListener('submit', submit); element.removeEventListener('click', click);
    options.householdElement?.removeEventListener('recipe-bank:household-change', householdChange);
    element.innerHTML = '';
  } };
}
