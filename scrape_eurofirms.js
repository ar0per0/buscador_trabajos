#!/usr/bin/env node

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const baseUrl = 'https://jobs.eurofirms.com';
const dataRoot = process.env.DATA_DIR || __dirname;
const outputFile = path.join(dataRoot, 'jobs.json');
const directUrl = String(process.env.EUROFIRMS_URL || '').trim();
const keyword = String(process.env.EUROFIRMS_KEYWORD || '').trim().slice(0, 120);
const city = String(process.env.EUROFIRMS_CITY || '').trim().slice(0, 120);
const delayMs = clamp(process.env.EUROFIRMS_DELAY_MS, 750, 500, 10000);
const maximumPages = clamp(process.env.EUROFIRMS_MAX_PAGES, 100, 1, 500);
function clamp(value, fallback, minimum, maximum) { const number = Number(value); return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, Math.floor(number))) : fallback; }
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
function decodeHtml(value) { const named = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' }; return String(value || '').replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (m, e) => { if (e[0] === '#') { const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m; } return named[e.toLowerCase()] ?? m; }); }
function plainText(value) { return decodeHtml(String(value || '').replace(/<br\s*\/?\s*>/gi, '\n').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim(); }
function sanitizeDescriptionHtml(value) { const allowed = new Set(['p', 'strong', 'b', 'em', 'i', 'u', 'ul', 'ol', 'li', 'br']); return String(value || '').replace(/<!--[^]*?-->/g, '').replace(/<(script|style)\b[^>]*>[^]*?<\/\1\s*>/gi, '').replace(/<[^>]*>/g, tag => { const match = tag.match(/^<\s*(\/?)\s*([a-z0-9]+)[^>]*>$/i); if (!match || !allowed.has(match[2].toLowerCase())) return ''; const name = match[2].toLowerCase(); return name === 'br' ? '<br>' : `<${match[1] ? '/' : ''}${name}>`; }).trim(); }
function slugify(value) { return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
function cleanEurofirmsUrl(value, listingOnly = false) { if (!String(value || '').trim()) return ''; try { const url = new URL(value, baseUrl); if (url.protocol !== 'https:' || !/(^|\.)eurofirms\.com$/i.test(url.hostname)) return ''; if (listingOnly && !/^\/es\/es\/trabajo(?:\/|$)/i.test(url.pathname)) return ''; url.hash = ''; return url.toString(); } catch { return ''; } }
function buildSearchUrl(search = {}) { if (search.url) { const url = cleanEurofirmsUrl(search.url, true); if (!url) throw new Error('la URL debe ser un listado de Eurofirms'); return url; } const url = new URL(`/es/es/trabajo${search.city ? `/${slugify(search.city)}` : ''}`, baseUrl); if (search.keyword) url.searchParams.set('search', String(search.keyword).trim()); return url.toString(); }
function cleanOfferUrl(value) { const url = cleanEurofirmsUrl(value); if (!url) return ''; const parsed = new URL(url); return /^\/es\/es\/(?!trabajo(?:\/|$))[^?]+/i.test(parsed.pathname) ? parsed.toString() : ''; }
function parseListing(html) {
  const regionStart = html.indexOf('id="offers-cards"');
  const regionEnd = regionStart >= 0 ? html.indexOf('id="paginationNumbers"', regionStart) : -1;
  const region = regionStart >= 0 ? html.slice(regionStart, regionEnd > regionStart ? regionEnd : html.length) : '';
  const entries = [...region.matchAll(/<a\s+href=['"]([^'"]+)['"][^>]*>[\s\S]*?<article\s+psf-offer([^>]*)>([\s\S]*?)<\/article>/gi)];
  const jobs = entries.map(match => {
    const url = cleanOfferUrl(match[1]); const attrs = match[2]; const block = match[3];
    const id = attrs.match(/data-ordercode=["']([^"']+)/i)?.[1] || url.match(/([\d]{3}-[\d]{6})\/?$/)?.[1] || '';
    const title = plainText(block.match(/psf-offer__title[^>]*>([\s\S]*?)<\/h3>/i)?.[1]);
    const location = plainText(block.match(/psf-offer__site[^>]*>([\s\S]*?)<\/h4>/i)?.[1]);
    const description = plainText(block.match(/psf-offer__description[^>]*>([\s\S]*?)<\/p>/i)?.[1]);
    const salary = plainText(block.match(/psf-offer__salary[^>]*>([\s\S]*?)<\/(?:div|p)>/i)?.[1]) || 'Salario a concretar';
    const dateMatches = [...block.matchAll(/(\d{2}\/\d{2}\/\d{4})/g)]; const date = dateMatches.at(-1)?.[1];
    return { source: 'Eurofirms', source_id: id, slug: `eurofirms-${id}`, title, company: 'Eurofirms', author: 'Eurofirms', description, url, country: 'España', countries: ['España'], location, modality: /teletrabajo|remoto/i.test(block) ? 'Teletrabajo' : '', workday: '', salary, budget: salary, budget_eur_min: null, budget_eur_max: null, salary_period: null, language: 'es', published_at: date ? `${date.slice(6)}-${date.slice(3,5)}-${date.slice(0,2)}` : null, published_label: '', urgent: /¡Nueva!|Nueva/i.test(block), minimumStudies: '', minimumExperience: '', requiredLanguages: [], eurofirmsDetailLoaded: false };
  }).filter(job => job.source_id && job.title && job.url);
  const total = Number(html.match(/([\d.]+)\s+resultados/i)?.[1]?.replace(/\./g, '')) || jobs.length;
  const pages = Math.max(1, ...[...html.matchAll(/data-page=["'](\d+)/gi)].map(match => Number(match[1])));
  return { jobs, total, pages };
}
function escapeJsonControlCharacters(value) { let output = ''; let quoted = false; let escaped = false; for (const character of String(value)) { if (escaped) { output += character; escaped = false; continue; } if (character === '\\') { output += character; escaped = true; continue; } if (character === '"') { output += character; quoted = !quoted; continue; } if (quoted && character === '\n') output += '\\n'; else if (quoted && character === '\r') output += '\\r'; else if (quoted && character === '\t') output += '\\t'; else output += character; } return output; }
function parseJobPosting(html) { for (const match of String(html).matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) { try { const value = JSON.parse(escapeJsonControlCharacters(match[1])); if (value?.['@type'] === 'JobPosting') return value; } catch {} } throw new Error('el detalle no contiene datos JobPosting válidos'); }
function detailFromPosting(posting) { const address = posting.jobLocation?.address || {}; const location = [address.addressLocality, address.addressRegion].filter((v, i, a) => v && a.indexOf(v) === i).join(', '); const salary = plainText(posting.baseSalary?.value?.value); return { description: plainText(posting.description), descriptionHtml: sanitizeDescriptionHtml(posting.description), company: plainText(posting.hiringOrganization?.name) || 'Eurofirms', author: plainText(posting.hiringOrganization?.name) || 'Eurofirms', location, workday: plainText(posting.workHours) || plainText(posting.employmentType), salary: salary || 'Salario a concretar', budget: salary || 'Salario a concretar', minimumStudies: '', minimumExperience: plainText(posting.experienceRequirements), requiredLanguages: [], published_at: posting.datePosted || null, eurofirmsDetailLoaded: true }; }
function parseDetail(html) {
  const source = String(html || '');
  const detail = detailFromPosting(parseJobPosting(source));
  const labelled = new Map();
  for (const match of source.matchAll(/<h4\b[^>]*>([\s\S]*?)<\/h4>\s*<span\b[^>]*>([\s\S]*?)<\/span>/gi)) {
    const label = plainText(match[1]).replace(/:\s*$/, '').toLowerCase();
    const value = plainText(match[2]).replace(/^\s*-\s*/, '');
    if (label && value && !labelled.has(label)) labelled.set(label, value);
  }
  const valueFor = pattern => [...labelled].find(([label]) => pattern.test(label))?.[1] || '';
  const workday = valueFor(/^(?:horario|jornada)$/) || detail.workday;
  const salary = valueFor(/^salario$/) || detail.salary;
  const minimumStudies = valueFor(/^(?:formaci[oó]n|estudios?(?: m[ií]nimos?)?)$/);
  const minimumExperience = valueFor(/^(?:experiencia|experiencia m[ií]nima)$/) || detail.minimumExperience;
  const languages = valueFor(/^idiomas?$/);
  const modality = valueFor(/^(?:modalidad|teletrabajo)$/);
  return { ...detail, workday, salary, budget: salary, minimumStudies, minimumExperience, requiredLanguages: languages ? [languages] : [], modality, eurofirmsDetailLoaded: true };
}
async function fetchHtml(url) { let last; for (let attempt = 1; attempt <= 3; attempt++) { try { const response = await fetch(url, { headers: { Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'es-ES,es;q=0.9', 'User-Agent': 'web-trabajos/1.0 (panel local de empleo)' }, signal: AbortSignal.timeout(45000) }); if (!response.ok) throw new Error(`HTTP ${response.status}`); return await response.text(); } catch (error) { last = error; if (attempt < 3) await wait(delayMs * attempt * 2); } } throw last; }
async function runSearch(search) { const first = new URL(buildSearchUrl(search)); first.searchParams.delete('page'); const jobs = new Map(); let total = null; let pages = 1; for (let page = 1; page <= Math.min(pages, maximumPages); page++) { const url = new URL(first); if (page > 1) url.searchParams.set('page', String(page)); process.stderr.write(`Eurofirms: descargando página ${page}${pages > 1 ? `/${pages}` : ''}…\n`); const parsed = parseListing(await fetchHtml(url)); total ??= parsed.total; pages = parsed.pages; for (const job of parsed.jobs) jobs.set(job.source_id, job); if (page < pages) await wait(delayMs); } return { jobs: [...jobs.values()], total, pages: Math.min(pages, maximumPages), complete: pages <= maximumPages, url: first.toString() }; }
async function writeJson(file, value) { const temp = `${file}.tmp`; await fs.promises.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`); await fs.promises.rename(temp, file); }
async function main() { const result = await runSearch({ url: directUrl, keyword, city }); const document = { scraped_at: new Date().toISOString(), source: result.url, method: 'public-html', complete: result.complete, pages_scraped: result.pages, total_elements_at_start: result.total, unique_records: result.jobs.length, jobs: result.jobs }; await fs.promises.mkdir(dataRoot, { recursive: true }); await writeJson(outputFile, document); process.stdout.write(`${JSON.stringify({ source: 'Eurofirms', complete: result.complete, pages_scraped: result.pages, unique_records: result.jobs.length, total_elements_at_start: result.total, scraped_at: document.scraped_at })}\n`); }
async function runChild(search, directory) { await new Promise((resolve, reject) => { const child = spawn(process.execPath, [__filename], { env: { ...process.env, DATA_DIR: directory, EUROFIRMS_SEARCHES: '', EUROFIRMS_URL: search.url || '', EUROFIRMS_KEYWORD: search.keyword || '', EUROFIRMS_CITY: search.city || '' }, stdio: ['ignore', 'pipe', 'pipe'] }); child.stdout.on('data', c => process.stderr.write(c)); child.stderr.on('data', c => process.stderr.write(c)); child.on('error', reject); child.on('close', code => code === 0 ? resolve() : reject(new Error(`la búsqueda terminó con código ${code}`))); }); }
async function mainBatch() { let searches; try { searches = JSON.parse(process.env.EUROFIRMS_SEARCHES || '[]'); } catch { throw new Error('las búsquedas de Eurofirms no son válidas'); } if (!Array.isArray(searches) || !searches.length) return main(); const jobs = new Map(); const completed = []; for (const search of searches.slice(0, 20)) { const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'web-trabajos-eurofirms-')); try { await runChild(search, directory); const document = JSON.parse(await fs.promises.readFile(path.join(directory, 'jobs.json'), 'utf8')); for (const job of document.jobs || []) jobs.set(job.source_id, job); completed.push({ url: search.url || '', keyword: search.keyword || '', city: search.city || '', total_elements: document.total_elements_at_start || 0 }); } finally { await fs.promises.rm(directory, { recursive: true, force: true }); } } const document = { scraped_at: new Date().toISOString(), source: `${baseUrl}/es/es/trabajo`, queries: completed, method: 'public-html', complete: true, unique_records: jobs.size, jobs: [...jobs.values()] }; await writeJson(outputFile, document); process.stdout.write(`${JSON.stringify({ source: 'Eurofirms', searches: completed.length, unique_records: jobs.size, scraped_at: document.scraped_at })}\n`); }
function hasBatchSearches(value) { try { const searches = JSON.parse(value || '[]'); return Array.isArray(searches) && searches.length > 0; } catch { return false; } }
if (require.main === module) (hasBatchSearches(process.env.EUROFIRMS_SEARCHES) ? mainBatch() : main()).catch(error => { process.stderr.write(`Eurofirms: ${error.message}\n`); process.exitCode = 1; });
module.exports = { buildSearchUrl, cleanEurofirmsUrl, cleanOfferUrl, detailFromPosting, hasBatchSearches, parseDetail, parseJobPosting, parseListing, plainText, sanitizeDescriptionHtml };
