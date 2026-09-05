#!/usr/bin/env node

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const baseUrl = 'https://jobtoday.com';
const dataRoot = process.env.DATA_DIR || __dirname;
const outputFile = path.join(dataRoot, 'jobs.json');
const directUrl = String(process.env.JOBTODAY_URL || '').trim();
const keyword = String(process.env.JOBTODAY_KEYWORD || '').trim().slice(0, 120);
const city = String(process.env.JOBTODAY_CITY || '').trim().slice(0, 120);
const delayMs = clampNumber(process.env.JOBTODAY_DELAY_MS, 750, 500, 10000);
const maximumPages = clampNumber(process.env.JOBTODAY_MAX_PAGES, 20, 1, 100);

function clampNumber(value, fallback, minimum, maximum) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, Math.floor(number))) : fallback;
}

const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function slugify(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function cleanJobTodayUrl(value, listingOnly = false) {
  if (!String(value || '').trim()) return '';
  try {
    const url = new URL(value, baseUrl);
    if (url.protocol !== 'https:' || !/(^|\.)jobtoday\.com$/i.test(url.hostname)) return '';
    if (listingOnly && !/^\/es\/trabajos(?:-|\/)/i.test(url.pathname)) return '';
    url.hash = '';
    return url.toString();
  } catch { return ''; }
}

function buildSearchUrl(search = {}) {
  if (search.url) {
    const safeUrl = cleanJobTodayUrl(search.url, true);
    if (!safeUrl) throw new Error('la URL debe ser un listado público de Job Today');
    return safeUrl;
  }
  const searchKeyword = slugify(search.keyword);
  const searchCity = slugify(search.city);
  if (!searchKeyword && !searchCity) throw new Error('indica un puesto o una ciudad');
  if (searchKeyword && searchCity) return `${baseUrl}/es/trabajos-${searchKeyword}-en/${searchCity}`;
  if (searchKeyword) return `${baseUrl}/es/trabajos-${searchKeyword}`;
  return `${baseUrl}/es/trabajos/${searchCity}`;
}

function parseNextData(html) {
  const match = String(html).match(/<script\s+id=["']__NEXT_DATA__["']\s+type=["']application\/json["']>([\s\S]*?)<\/script>/i);
  if (!match) throw new Error('no se encontraron los datos públicos del listado');
  return JSON.parse(match[1]);
}

function safeOfferUrl(offer) {
  const canonical = cleanJobTodayUrl(offer.canonicalUrl);
  if (canonical) return canonical;
  try {
    const url = new URL(String(offer.externalUrl || ''));
    return url.protocol === 'https:' && /(^|\.)jobtoday\.com$/i.test(url.hostname) ? url.toString() : '';
  } catch { return ''; }
}

function formattedDetailValue(offer, title) {
  const detail = (offer.formattedDetails || []).find(item => String(item?.title?.es || '').toLocaleLowerCase('es') === title.toLocaleLowerCase('es'));
  return String(detail?.content?.text?.es || '').replace(/\*/g, '').trim();
}

function jobTodayLanguages(offer) {
  const levelLabels = { BASIC: 'Básico', INTERMEDIATE: 'Intermedio', ADVANCED: 'Avanzado', NATIVE: 'Nativo' };
  return (Array.isArray(offer.languages) ? offer.languages : []).map(item => {
    const language = String(item?.language?.es || item?.language?.name || item?.language || '').trim();
    const level = levelLabels[String(item?.level || '').toUpperCase()] || String(item?.level || '').trim();
    return [language, level].filter(Boolean).join(' · ');
  }).filter(Boolean);
}

function jobTodaySalary(salary) {
  if (!salary || salary.isValid === false) return { label: 'No indicado', min: null, max: null, period: null };
  const minimum = Number(salary.from);
  const maximum = Number(salary.to);
  if (!Number.isFinite(minimum) && !Number.isFinite(maximum)) return { label: 'No indicado', min: null, max: null, period: null };
  const period = String(salary.period || '').toUpperCase();
  const periodLabels = { HOURLY: 'hora', DAILY: 'día', WEEKLY: 'semana', MONTHLY: 'mes', YEARLY: 'año' };
  const currency = salary.currencyCode === 'EUR' ? '€' : String(salary.currencyCode || '').trim();
  const format = value => Number(value).toLocaleString('es-ES');
  const range = Number.isFinite(minimum) && Number.isFinite(maximum) && minimum !== maximum
    ? `${format(minimum)} ${currency} – ${format(maximum)} ${currency}`
    : `${format(Number.isFinite(minimum) ? minimum : maximum)} ${currency}`;
  return { label: `${range}/${periodLabels[period] || period.toLocaleLowerCase('es')}`.replace(/\/$/, ''), min: Number.isFinite(minimum) ? minimum : maximum, max: Number.isFinite(maximum) ? maximum : minimum, period };
}

function sanitizeJobTodayDescription(value) {
  const allowedTags = new Set(['p', 'strong', 'b', 'em', 'i', 'u', 'ul', 'ol', 'li', 'br']);
  return String(value || '').replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '').replace(/<[^>]*>/g, tag => {
    const match = tag.match(/^<\s*(\/?)\s*([a-z0-9]+)[^>]*>$/i);
    if (!match || !allowedTags.has(match[2].toLowerCase())) return '';
    const name = match[2].toLowerCase();
    return name === 'br' ? '<br>' : `<${match[1] ? '/' : ''}${name}>`;
  }).trim();
}

function normalizeOffer(offer) {
  const id = String(offer.key || '').trim();
  const description = String(offer.descriptionDeMarkdown || offer.description || '').trim();
  const address = offer.addressInfo?.display || {};
  const location = String(address.cityAddress || address.primaryName || offer.address || '').trim();
  const modality = /(?:100\s*%\s*)?(?:teletrabajo|remoto|remote)/i.test(description)
    ? 'Teletrabajo'
    : /h[ií]brid/i.test(description) ? 'Híbrido' : '';
  const employmentType = String(offer.employmentType?.label || offer.employmentType || offer.type || '').trim();
  const workdayLabels = { FULL_TIME: 'Jornada completa', PART_TIME: 'Jornada parcial', TEMPORARY: 'Temporal' };
  const salary = jobTodaySalary(offer.salary);
  const publishedAt = Number(offer.createDate || offer.updateDate);
  return {
    source: 'Job Today', source_id: id, slug: `jobtoday-${id}`, title: String(offer.role || '').trim(),
    company: String(offer.companyName || offer.company?.name || '').trim(), author: String(offer.companyName || offer.company?.name || '').trim(),
    description, url: safeOfferUrl(offer), country: 'España', countries: ['España'], location,
    modality, workday: workdayLabels[employmentType] || employmentType, salary: salary.label, budget: salary.label,
    budget_eur_min: salary.min, budget_eur_max: salary.max, salary_period: salary.period, language: 'es',
    published_at: Number.isFinite(publishedAt) ? new Date(publishedAt).toISOString() : null,
    published_label: '', urgent: Boolean(offer.urgent || offer.immediateStart), minimumStudies: '',
    minimumExperience: offer.experienceNotRequired ? 'Sin experiencia' : formattedDetailValue(offer, 'Experiencia'), requiredLanguages: jobTodayLanguages(offer),
    categories: (offer.categories || []).map(item => String(item?.label || '')).filter(Boolean),
    jobTodayDetailLoaded: !/^https:\/\/(?:www\.)?jobtoday\.com\/es\/trabajo\//i.test(safeOfferUrl(offer)),
  };
}

function parseDetail(html) {
  const offer = parseNextData(html)?.props?.pageProps?.job;
  if (!offer || typeof offer !== 'object') throw new Error('el detalle no contiene una oferta pública válida');
  const detail = normalizeOffer(offer);
  return {
    description: detail.description,
    descriptionHtml: sanitizeJobTodayDescription(offer.descriptionHTML),
    minimumExperience: detail.minimumExperience,
    requiredLanguages: detail.requiredLanguages,
    workday: formattedDetailValue(offer, 'Jornada') || detail.workday,
    salary: formattedDetailValue(offer, 'Salario') || detail.salary,
    budget: detail.budget,
    budget_eur_min: detail.budget_eur_min,
    budget_eur_max: detail.budget_eur_max,
    salary_period: detail.salary_period,
    location: detail.location,
    jobTodayDetailLoaded: true,
  };
}

function parseListing(html) {
  const pageProps = parseNextData(html)?.props?.pageProps || {};
  const rawJobs = (pageProps.feed?.sections || []).flatMap(section => section.items || [])
    .filter(item => item?.type === 'job' && item.payload).map(item => item.payload);
  const jobs = rawJobs.map(normalizeOffer).filter(job => job.source_id && job.title && job.url);
  const title = String(pageProps.pageMeta?.tags?.title || pageProps.pageMeta?.title || html.match(/<title[^>]*>([^<]+)/i)?.[1] || '');
  const totalMatch = title.match(/([\d.]+)\s+(?:ofertas|mejores|best)/i);
  const total = Number(totalMatch?.[1]?.replace(/\./g, '')) || null;
  return { jobs, total, pagination: pageProps.pagination || {} };
}

async function fetchHtml(url) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'es-ES,es;q=0.9', 'User-Agent': 'web-trabajos/1.0 (panel local de empleo)' },
        redirect: 'follow', signal: AbortSignal.timeout(45000),
      });
      const html = await response.text();
      let hasPublicListingData = false;
      if (response.status === 410) {
        try {
          hasPublicListingData = Array.isArray(parseNextData(html)?.props?.pageProps?.feed?.sections);
        } catch {}
      }
      if (!response.ok && !hasPublicListingData) throw new Error(`HTTP ${response.status}`);
      return { html, finalUrl: response.url };
    } catch (error) {
      lastError = error;
      if (attempt < 3) await wait(delayMs * attempt * 2);
    }
  }
  throw lastError;
}

async function runSearch(search) {
  const firstUrl = new URL(buildSearchUrl(search));
  firstUrl.searchParams.delete('page');
  const jobs = new Map();
  let page = 1;
  let total = null;
  let hasNext = true;
  let resolvedUrl = firstUrl.toString();
  while (hasNext && page <= maximumPages) {
    const pageUrl = new URL(firstUrl);
    if (page > 1) pageUrl.searchParams.set('page', String(page));
    process.stderr.write(`Job Today: descargando página ${page}…\n`);
    const response = await fetchHtml(pageUrl);
    resolvedUrl = response.finalUrl;
    const parsed = parseListing(response.html);
    total ||= parsed.total;
    for (const job of parsed.jobs) jobs.set(job.source_id, job);
    hasNext = Boolean(parsed.pagination.hasNext);
    page += 1;
    if (hasNext && page <= maximumPages) await wait(delayMs);
  }
  return { jobs: [...jobs.values()], total, pages: page - 1, complete: !hasNext, url: resolvedUrl };
}

async function writeJsonAtomically(file, value) {
  const temporaryFile = `${file}.tmp`;
  await fs.promises.writeFile(temporaryFile, `${JSON.stringify(value, null, 2)}\n`);
  await fs.promises.rename(temporaryFile, file);
}

async function main() {
  const result = await runSearch({ url: directUrl, keyword, city });
  const document = { scraped_at: new Date().toISOString(), source: result.url, method: 'public-ssr-html', complete: result.complete, pages_scraped: result.pages, total_elements_at_start: result.total, unique_records: result.jobs.length, jobs: result.jobs };
  await fs.promises.mkdir(dataRoot, { recursive: true });
  await writeJsonAtomically(outputFile, document);
  process.stdout.write(`${JSON.stringify({ source: 'Job Today', complete: result.complete, pages_scraped: result.pages, unique_records: result.jobs.length, total_elements_at_start: result.total, scraped_at: document.scraped_at })}\n`);
}

async function runChild(search, directory) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [__filename], { env: { ...process.env, DATA_DIR: directory, JOBTODAY_SEARCHES: '', JOBTODAY_URL: search.url || '', JOBTODAY_KEYWORD: search.keyword || '', JOBTODAY_CITY: search.city || '' }, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', chunk => process.stderr.write(chunk));
    child.stderr.on('data', chunk => process.stderr.write(chunk));
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(new Error(`la búsqueda terminó con código ${code}`)));
  });
}

async function mainBatch() {
  let searches;
  try { searches = JSON.parse(process.env.JOBTODAY_SEARCHES || '[]'); } catch { throw new Error('las búsquedas de Job Today no son válidas'); }
  if (!Array.isArray(searches) || !searches.length) return main();
  const jobs = new Map();
  const completed = [];
  for (const search of searches.slice(0, 20)) {
    const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'web-trabajos-jobtoday-'));
    try {
      await runChild(search, directory);
      const document = JSON.parse(await fs.promises.readFile(path.join(directory, 'jobs.json'), 'utf8'));
      for (const job of document.jobs || []) jobs.set(job.source_id, job);
      completed.push({ url: search.url || '', keyword: search.keyword || '', city: search.city || '', total_elements: document.total_elements_at_start || 0 });
    } finally { await fs.promises.rm(directory, { recursive: true, force: true }); }
  }
  const document = { scraped_at: new Date().toISOString(), source: `${baseUrl}/es/trabajos`, queries: completed, method: 'public-ssr-html', complete: true, unique_records: jobs.size, jobs: [...jobs.values()] };
  await writeJsonAtomically(outputFile, document);
  process.stdout.write(`${JSON.stringify({ source: 'Job Today', searches: completed.length, unique_records: jobs.size, scraped_at: document.scraped_at })}\n`);
}

function hasBatchSearches(value) {
  try { const searches = JSON.parse(value || '[]'); return Array.isArray(searches) && searches.length > 0; } catch { return false; }
}

if (require.main === module) (hasBatchSearches(process.env.JOBTODAY_SEARCHES) ? mainBatch() : main()).catch(error => { process.stderr.write(`Job Today: ${error.message}\n`); process.exitCode = 1; });

module.exports = { buildSearchUrl, cleanJobTodayUrl, hasBatchSearches, jobTodaySalary, normalizeOffer, parseDetail, parseListing, parseNextData, safeOfferUrl, slugify };
