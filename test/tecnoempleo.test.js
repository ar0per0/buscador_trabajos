const test = require('node:test');
const assert = require('node:assert/strict');

const { buildSearchUrl, cleanTecnoempleoUrl, detailFromPosting, parseDetail, parseJobPosting, parseListing, parseSalary } = require('../scrape_tecnoempleo');

test('construye búsquedas simples y valida URLs avanzadas', () => {
  assert.equal(buildSearchUrl({ keyword: 'Programador Java', city: 'Girona' }), 'https://www.tecnoempleo.com/ofertas-trabajo/girona/programador-java');
  assert.match(buildSearchUrl({ url: 'https://www.tecnoempleo.com/ofertas-trabajo/?te=it&pr=,252,' }), /tecnoempleo\.com\/ofertas-trabajo/);
  assert.equal(cleanTecnoempleoUrl('https://example.com/ofertas-trabajo/'), '');
  assert.throws(() => buildSearchUrl({ url: 'https://www.tecnoempleo.com/empresa' }), /listado/);
});

test('normaliza salarios anuales y mensuales', () => {
  assert.deepEqual(parseSalary('30.000€ - 39.000€ b/a'), { label: '30.000€ - 39.000€ b/a', min: 30000, max: 39000, period: 'YEAR' });
  assert.equal(parseSalary('2.700€ - 6.000€ b/m').period, 'MONTH');
});

test('extrae una tarjeta del listado público', () => {
  const html = `<h1>1 Oferta</h1><a name="rf-abc123" id="rf-abc123"></a><div><h3><a href="https://www.tecnoempleo.com/desarrollador/skills/rf-abc123" title="Desarrollador">Desarrollador</a></h3><a title="Ofertas de Empleo Empresa" href="/empresa">Empresa</a><span class="d-block d-lg-none"><b>Girona (Híbrido)</b> - 03/09/2026 Nueva</span><span class="hidden-md-down text-gray-800"><br>Descripción breve<br><span class="badge">Java</span></span>30.000€ - 39.000€ b/a</div>1-1 de <b>1</b> Ofertas de Empleo<nav>`;
  const result = parseListing(html);
  assert.equal(result.total, 1);
  assert.equal(result.jobs[0].source_id, 'rf-abc123');
  assert.equal(result.jobs[0].location, 'Girona (Híbrido)');
  assert.equal(result.jobs[0].budget_eur_min, 30000);
  assert.deepEqual(result.jobs[0].technologies, ['Java']);
});

test('extrae el detalle JobPosting', () => {
  const posting = parseJobPosting('<script type="application/ld+json">{"@type":"JobPosting","description":"Trabajo completo","datePosted":"2026-09-03","employmentType":"FULL_TIME","jobLocationType":"TELECOMMUTE","hiringOrganization":{"name":"Empresa"}}</script>');
  const detail = detailFromPosting(posting);
  assert.equal(detail.description, 'Trabajo completo');
  assert.equal(detail.modality, '100% remoto');
  assert.equal(detail.company, 'Empresa');
});

test('conserva el formato y los bloques principales del detalle', () => {
  const html = `<div itemprop="description"><h2>Descripción</h2><div class="fs--16 text-gray-800"><p>Texto <strong>importante</strong></p><br><br><ul><li>Java</li></ul><script>alert(1)</script></div></div>
    <ul><li class="list-item"><span class="float-end">100% En remoto</span><span class="d-inline-block px-2">Ubicación</span></li>
    <li class="list-item"><span class="float-end">Jornada completa</span><span class="d-inline-block px-2">Jornada</span></li>
    <li class="list-item"><span class="float-end">3 años</span><span class="d-inline-block px-2">Experiencia</span></li></ul>
    <div><p class="m-0">Formación Mínima: Ingeniero Técnico</p></div>
    <div><p class="m-0">Idiomas: Inglés (Alto), Francés (Medio)</p></div>
    <script type="application/ld+json">{"@type":"JobPosting","description":"Texto importante","employmentType":"FULL_TIME","hiringOrganization":{"name":"Empresa"}}</script>`;
  const detail = parseDetail(html);
  assert.match(detail.descriptionHtml, /<strong>importante<\/strong>/);
  assert.match(detail.descriptionHtml, /<ul><li>Java<\/li><\/ul>/);
  assert.doesNotMatch(detail.descriptionHtml, /script|alert/);
  assert.equal(detail.minimumExperience, '3 años');
  assert.equal(detail.minimumStudies, 'Ingeniero Técnico');
  assert.deepEqual(detail.requiredLanguages, ['Inglés (Alto)', 'Francés (Medio)']);
  assert.equal(detail.workday, 'Jornada completa');
  assert.equal(detail.modality, '100% En remoto');
});
