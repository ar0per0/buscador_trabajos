#!/usr/bin/env node

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const baseUrl = 'https://www.infoempleo.com';
const dataRoot = process.env.DATA_DIR || __dirname;
const outputFile = path.join(dataRoot, 'jobs.json');
const directUrl = String(process.env.INFOEMPLEO_URL || '').trim();
const keyword = String(process.env.INFOEMPLEO_KEYWORD || '').trim().slice(0, 120);
const city = String(process.env.INFOEMPLEO_CITY || '').trim().slice(0, 120);
const delayMs = clampNumber(process.env.INFOEMPLEO_DELAY_MS, 750, 500, 10000);
const maximumPages = clampNumber(process.env.INFOEMPLEO_MAX_PAGES, 100, 1, 500);

function clampNumber(value, fallback, minimum, maximum) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, Math.floor(number))) : fallback;
}
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function decodeHtml(value) {
  const named = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ', ntilde: 'ñ', aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú' };
  return String(value || '').replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
    if (entity[0] === '#') {
      const number = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return Number.isFinite(number) ? String.fromCodePoint(number) : match;
    }
    return named[entity.toLowerCase()] ?? match;
  });
}
function plainText(value) { return decodeHtml(String(value || '').replace(/<br\s*\/?\s*>/gi, '\n').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim(); }

function cleanInfoempleoUrl(value, listingOnly = false) {
  if (!String(value || '').trim()) return '';
  try {
    const url = new URL(value, baseUrl);
    if (url.protocol !== 'https:' || !/(^|\.)infoempleo\.com$/i.test(url.hostname)) return '';
    if (listingOnly && !/^\/trabajo(?:\/|$)/i.test(url.pathname)) return '';
    url.hash = '';
    return url.toString();
  } catch { return ''; }
}

function buildSearchUrl(search = {}) {
  if (search.url) {
    const safeUrl = cleanInfoempleoUrl(search.url, true);
    if (!safeUrl) throw new Error('la URL debe ser un listado de Infoempleo');
    return safeUrl;
  }
  const url = new URL('/trabajo/', baseUrl);
  if (search.keyword) url.searchParams.set('search', String(search.keyword).trim());
  if (search.city) url.searchParams.set('region', String(search.city).trim());
  return url.toString();
}

function cleanOfferUrl(value) {
  const url = cleanInfoempleoUrl(value);
  if (!url) return '';
  const parsed = new URL(url);
  return /^\/ofertasdetrabajo\//i.test(parsed.pathname) ? parsed.toString() : '';
}

function parseListing(html) {
  if (/No encontramos ofertas para esta b[uú]squeda/i.test(html)) return { jobs: [], total: 0, pages: 0 };
  const listStart = html.search(/<ul[^>]*class=["'][^"']*positions[^"']*["']/i);
  const paginationStart = listStart >= 0 ? html.indexOf('<ul class="pagination', listStart) : -1;
  const listEnd = paginationStart > listStart ? paginationStart : -1;
  const list = listStart >= 0 ? html.slice(listStart, listEnd > listStart ? listEnd : html.length) : '';
  const blocks = list.split(/<li\s+class=["'][^"']*offerblock[^"']*["'][^>]*>/i).slice(1);
  const allJobs = blocks.map(block => {
    const titleMatch = block.match(/<h2[^>]*>[\s\S]*?<a\s+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    const url = cleanOfferUrl(titleMatch?.[1]);
    const id = url.match(/\/(\d+)\/?$/)?.[1] || '';
    const description = plainText(block.match(/<p\s+class=["'][^"']*trunkat[^"']*["'][^>]*>([\s\S]*?)(?=<p\s+class=["'][^"']*small)/i)?.[1]);
    const requirements = plainText(block.match(/<p\s+class=["'][^"']*small extra-data[^"']*["'][^>]*>([\s\S]*?)(?=<div\s+class=["']logoplusname)/i)?.[1]);
    const company = plainText(block.match(/<div\s+class=["']logoplusname[^"']*["'][^>]*>[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/i)?.[1]);
    const afterCompany = block.slice(block.indexOf('logoplusname'));
    const location = plainText(afterCompany.match(/icon-map-marker[\s\S]*?<\/svg>\s*<\/span>\s*([^<]+)/i)?.[1]);
    const publishedLabel = plainText(afterCompany.match(/icon-clock[\s\S]*?<span\s+class=["']extra-data["'][^>]*>([\s\S]*?)<\/span>/i)?.[1]);
    const workday = requirements.split('|').map(value => value.trim()).find(value => /jornada/i.test(value)) || '';
    const minimumExperience = requirements.split('|')[0]?.trim() || '';
    return { source: 'Infoempleo', source_id: id, slug: `infoempleo-${id}`, title: plainText(titleMatch?.[2]), company, author: company, description, url, country: 'España', countries: ['España'], location, modality: /teletrabajo parcial/i.test(block) ? 'Híbrido' : /teletrabajo/i.test(block) ? 'Teletrabajo' : '', workday, salary: 'No indicado', budget: 'No indicado', budget_eur_min: null, budget_eur_max: null, salary_period: null, language: 'es', published_at: null, published_label: publishedLabel, urgent: /urge|urgente/i.test(block), minimumStudies: '', minimumExperience, requiredLanguages: [], infoempleoDetailLoaded: false };
  }).filter(job => job.source_id && job.title && job.url);
  const total = Number(html.match(/Mostrando\s+\d+\s*-\s*\d+\s+de\s+([\d.]+)\s+ofertas/i)?.[1]?.replace(/\./g, '')) || allJobs.length;
  const currentPage = Number(html.match(/<li\s+class=["']active["'][^>]*>[\s\S]*?verPagina\((\d+)\)/i)?.[1]) || 1;
  const jobs = allJobs.slice(0, Math.max(0, Math.min(20, total - (currentPage - 1) * 20)));
  return { jobs, total, pages: Math.ceil(total / 20) };
}

function parseJobPosting(html) {
  for (const match of String(html).matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { const value = JSON.parse(match[1]); if (value?.['@type'] === 'JobPosting') return value; } catch {}
  }
  throw new Error('el detalle no contiene datos JobPosting válidos');
}

function stripDescriptionHtml(value) { return plainText(value); }

function sanitizeDescriptionHtml(value) {
  const allowedTags = new Set(['p', 'strong', 'b', 'em', 'i', 'u', 'ul', 'ol', 'li', 'br']);
  const source = String(value || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<h[1-6]\b[^>]*>/gi, '<p><strong>')
    .replace(/<\/h[1-6]\s*>/gi, '</strong></p>')
    .replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, (_, text) => `<p>${text.replace(/\r?\n|\r/g, '<br>')}</p>`)
    .replace(/(<p\b[^>]*>)([\s\S]*?)(<\/p>)/gi, (_, open, text, close) => `${open}${text.replace(/\r?\n|\r/g, '<br>')}${close}`);
  return source.replace(/<[^>]*>/g, tag => {
    const match = tag.match(/^<\s*(\/?)\s*([a-z0-9]+)[^>]*>$/i);
    if (!match || !allowedTags.has(match[2].toLowerCase())) return '';
    const name = match[2].toLowerCase();
    return name === 'br' ? '<br>' : `<${match[1] ? '/' : ''}${name}>`;
  }).trim();
}

function excerptValues(html) {
  const excerpt = String(html).match(/<div\b[^>]*class=["'][^"']*offer-excerpt[^"']*["'][^>]*>([\s\S]*?)(?=<div\b[^>]*class=["'][^"']*accordion-handler)/i)?.[1] || '';
  const values = {};
  for (const match of excerpt.matchAll(/<h3\b[^>]*class=["'][^"']*subtitle[^"']*["'][^>]*>([\s\S]*?)<\/h3>\s*<p\b[^>]*>([\s\S]*?)(?=<li\b|<\/ul>|<h3\b)/gi)) {
    values[plainText(match[1]).toLocaleLowerCase('es')] = plainText(match[2]);
  }
  return values;
}

function salaryFromPosting(posting) {
  const salary = posting?.baseSalary;
  const value = salary?.value || {};
  const minimum = Number(value.minValue);
  const maximum = Number(value.maxValue);
  if (!Number.isFinite(minimum) && !Number.isFinite(maximum)) return {};
  const currency = salary.currency === 'EUR' ? '€' : plainText(salary.currency);
  const period = String(value.unitText || salary.unitText || '').toUpperCase();
  const periodLabel = { YEAR: 'año', MONTH: 'mes', WEEK: 'semana', DAY: 'día', HOUR: 'hora' }[period] || period.toLocaleLowerCase('es');
  const format = number => Number(number).toLocaleString('es-ES');
  const label = minimum !== maximum && Number.isFinite(minimum) && Number.isFinite(maximum)
    ? `${format(minimum)} ${currency} – ${format(maximum)} ${currency}/${periodLabel}`
    : `${format(Number.isFinite(minimum) ? minimum : maximum)} ${currency}/${periodLabel}`;
  return { salary: label, budget: label, budget_eur_min: Number.isFinite(minimum) ? minimum : maximum, budget_eur_max: Number.isFinite(maximum) ? maximum : minimum, salary_period: period || null };
}

function detailFromPosting(posting) {
  const locationEntry = Array.isArray(posting.jobLocation) ? posting.jobLocation.find(item => item?.address?.addressLocality) || posting.jobLocation[0] : posting.jobLocation;
  const address = locationEntry?.address || {};
  const location = [address.addressLocality, address.addressRegion].filter((value, index, values) => value && values.indexOf(value) === index).join(', ');
  return { description: stripDescriptionHtml(posting.description), descriptionHtml: sanitizeDescriptionHtml(posting.description), company: plainText(posting.hiringOrganization?.name), author: plainText(posting.hiringOrganization?.name), location, workday: posting.workHours || (posting.employmentType === 'FULL_TIME' ? 'Jornada completa' : plainText(posting.employmentType)), minimumStudies: plainText(posting.educationRequirements), minimumExperience: plainText(posting.experienceRequirements), requiredLanguages: [], ...salaryFromPosting(posting), published_at: posting.datePosted || null, infoempleoDetailLoaded: true };
}

function parseDetail(html) {
  const posting = parseJobPosting(html);
  const detail = detailFromPosting(posting);
  const values = excerptValues(html);
  const salary = values.salario && !/sin especificar/i.test(values.salario) ? values.salario : detail.salary;
  const languages = values['idiomas requeridos'] || values.idiomas || values.idioma || '';
  return {
    ...detail,
    salary: salary || 'No indicado', budget: salary || detail.budget || 'No indicado',
    modality: values.modalidad || values['modalidad de trabajo'] || detail.modality || '',
    workday: values.jornada || detail.workday,
    minimumStudies: values['estudios mínimos'] || values['estudios minimos'] || values.estudios || detail.minimumStudies,
    minimumExperience: values['experiencia mínima'] || values['experiencia minima'] || values.experiencia || detail.minimumExperience,
    requiredLanguages: languages.split(/[,;|]/).map(value => value.trim()).filter(Boolean),
    contractType: values.contrato || '',
  };
}

async function fetchHtml(url) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try { const response = await fetch(url, { headers: { Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'es-ES,es;q=0.9', 'User-Agent': 'web-trabajos/1.0 (panel local de empleo)' }, signal: AbortSignal.timeout(45000) }); if (!response.ok) throw new Error(`HTTP ${response.status}`); return await response.text(); }
    catch (error) { lastError = error; if (attempt < 3) await wait(delayMs * attempt * 2); }
  }
  throw lastError;
}

async function runSearch(search) {
  const firstUrl = new URL(buildSearchUrl(search)); firstUrl.searchParams.delete('pagina');
  const jobs = new Map(); let total = null; let pages = 1;
  for (let page = 1; page <= Math.min(pages, maximumPages); page += 1) {
    const url = new URL(firstUrl); if (page > 1) url.searchParams.set('pagina', String(page));
    process.stderr.write(`Infoempleo: descargando página ${page}${pages > 1 ? `/${pages}` : ''}…\n`);
    const parsed = parseListing(await fetchHtml(url)); total ??= parsed.total; pages = parsed.pages;
    for (const job of parsed.jobs) jobs.set(job.source_id, job);
    if (page < pages) await wait(delayMs);
  }
  return { jobs: [...jobs.values()], total, pages: Math.min(pages, maximumPages), complete: pages <= maximumPages, url: firstUrl.toString() };
}

async function writeJsonAtomically(file, value) { const temporaryFile = `${file}.tmp`; await fs.promises.writeFile(temporaryFile, `${JSON.stringify(value, null, 2)}\n`); await fs.promises.rename(temporaryFile, file); }

async function main() {
  const result = await runSearch({ url: directUrl, keyword, city });
  const document = { scraped_at: new Date().toISOString(), source: result.url, method: 'public-html', complete: result.complete, pages_scraped: result.pages, total_elements_at_start: result.total, unique_records: result.jobs.length, jobs: result.jobs };
  await fs.promises.mkdir(dataRoot, { recursive: true }); await writeJsonAtomically(outputFile, document);
  process.stdout.write(`${JSON.stringify({ source: 'Infoempleo', complete: result.complete, pages_scraped: result.pages, unique_records: result.jobs.length, total_elements_at_start: result.total, scraped_at: document.scraped_at })}\n`);
}

async function runChild(search, directory) { await new Promise((resolve, reject) => { const child = spawn(process.execPath, [__filename], { env: { ...process.env, DATA_DIR: directory, INFOEMPLEO_SEARCHES: '', INFOEMPLEO_URL: search.url || '', INFOEMPLEO_KEYWORD: search.keyword || '', INFOEMPLEO_CITY: search.city || '' }, stdio: ['ignore', 'pipe', 'pipe'] }); child.stdout.on('data', chunk => process.stderr.write(chunk)); child.stderr.on('data', chunk => process.stderr.write(chunk)); child.on('error', reject); child.on('close', code => code === 0 ? resolve() : reject(new Error(`la búsqueda terminó con código ${code}`))); }); }

async function mainBatch() {
  let searches; try { searches = JSON.parse(process.env.INFOEMPLEO_SEARCHES || '[]'); } catch { throw new Error('las búsquedas de Infoempleo no son válidas'); }
  if (!Array.isArray(searches) || !searches.length) return main();
  const jobs = new Map(); const completed = [];
  for (const search of searches.slice(0, 20)) { const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'web-trabajos-infoempleo-')); try { await runChild(search, directory); const document = JSON.parse(await fs.promises.readFile(path.join(directory, 'jobs.json'), 'utf8')); for (const job of document.jobs || []) jobs.set(job.source_id, job); completed.push({ url: search.url || '', keyword: search.keyword || '', city: search.city || '', total_elements: document.total_elements_at_start || 0 }); } finally { await fs.promises.rm(directory, { recursive: true, force: true }); } }
  const document = { scraped_at: new Date().toISOString(), source: `${baseUrl}/trabajo/`, queries: completed, method: 'public-html', complete: true, unique_records: jobs.size, jobs: [...jobs.values()] }; await writeJsonAtomically(outputFile, document); process.stdout.write(`${JSON.stringify({ source: 'Infoempleo', searches: completed.length, unique_records: jobs.size, scraped_at: document.scraped_at })}\n`);
}

function hasBatchSearches(value) { try { const searches = JSON.parse(value || '[]'); return Array.isArray(searches) && searches.length > 0; } catch { return false; } }
if (require.main === module) (hasBatchSearches(process.env.INFOEMPLEO_SEARCHES) ? mainBatch() : main()).catch(error => { process.stderr.write(`Infoempleo: ${error.message}\n`); process.exitCode = 1; });
module.exports = { buildSearchUrl, cleanInfoempleoUrl, cleanOfferUrl, detailFromPosting, hasBatchSearches, parseDetail, parseJobPosting, parseListing, plainText, sanitizeDescriptionHtml };
