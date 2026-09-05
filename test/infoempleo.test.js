const test = require('node:test');
const assert = require('node:assert/strict');

const { buildSearchUrl, detailFromPosting, parseDetail, parseJobPosting, parseListing } = require('../scrape_infoempleo');

test('construye y valida búsquedas de Infoempleo', () => {
  assert.match(buildSearchUrl({ keyword: 'it', city: 'Girona' }), /search=it&region=Girona/);
  assert.match(buildSearchUrl({ url: 'https://www.infoempleo.com/trabajo/?search=it' }), /infoempleo\.com\/trabajo/);
  assert.equal(
    buildSearchUrl({ url: 'https://www.infoempleo.com/trabajo/en_girona/?search=sistemes&region=Girona&ordenacion=Relevancia&diasPublicacion=15&jornadaLaboral=completa' }),
    'https://www.infoempleo.com/trabajo/en_girona/?search=sistemes&region=Girona&ordenacion=Relevancia&diasPublicacion=15&jornadaLaboral=completa',
  );
  assert.throws(() => buildSearchUrl({ url: 'https://www.infoempleo.com/cursos/' }), /listado/);
});

test('no mezcla recomendaciones cuando no hay coincidencias', () => {
  const html = 'No encontramos ofertas para esta búsqueda<ul class="positions"><li class="offerblock"><h2><a href="/ofertasdetrabajo/falsa/x/1/">Falsa</a></h2></ul>';
  assert.deepEqual(parseListing(html), { jobs: [], total: 0, pages: 0 });
});

test('normaliza una tarjeta del listado', () => {
  const html = `<div>Mostrando 1-1 de 1 ofertas</div><ul class="mt15 positions"><li class="offerblock"><h2 class="title"><a href="/ofertasdetrabajo/desarrollador/girona/123/">Desarrollador IT</a></h2><p class="trunkat">Descripción breve</p><p class="small extra-data">Al menos 2 años de experiencia | jornada completa</p><div class="logoplusname"><span class="extra-data">Empresa</span></div><span><svg><use xlink:href="#icon-map-marker"></use></svg></span> Girona<span><svg><use xlink:href="#icon-clock"></use></svg></span><span class="extra-data">Hace 2 horas</span></li></ul>`;
  const result = parseListing(html);
  assert.equal(result.total, 1);
  assert.equal(result.jobs[0].source_id, '123');
  assert.equal(result.jobs[0].company, 'Empresa');
  assert.equal(result.jobs[0].minimumExperience, 'Al menos 2 años de experiencia');
});

test('extrae el detalle JobPosting', () => {
  const html = '<script type="application/ld+json">{"@type":"JobPosting","description":"<p>Completa</p>","datePosted":"2026-09-03","experienceRequirements":"2 años","hiringOrganization":{"name":"Empresa"},"jobLocation":{"address":{"addressLocality":"Girona","addressRegion":"Girona"}}}</script>';
  const detail = detailFromPosting(parseJobPosting(html));
  assert.equal(detail.description, 'Completa');
  assert.equal(detail.location, 'Girona');
});

test('conserva el formato y completa los campos visibles del detalle', () => {
  const posting = { '@type': 'JobPosting', description: '<p>Línea 1\n<strong>Línea 2</strong></p><h3>Requisitos</h3><p>Inglés</p>', baseSalary: { currency: 'EUR', value: { minValue: 20000, maxValue: 26000, unitText: 'YEAR' } }, hiringOrganization: { name: 'Empresa' } };
  const html = `<script type="application/ld+json">${JSON.stringify(posting)}</script><div class="offer-excerpt"><ul><li><h3 class="subtitle">Experiencia</h3><p>2 años<li><h3 class="subtitle">Jornada</h3><p>Completa<li><h3 class="subtitle">Estudios mínimos</h3><p>Grado<li><h3 class="subtitle">Idiomas</h3><p>Inglés B2, Español</ul></div><div class="accordion-handler">Detalle</div>`;
  const detail = parseDetail(html);
  assert.match(detail.descriptionHtml, /Línea 1<br><strong>Línea 2<\/strong>/);
  assert.match(detail.descriptionHtml, /<p><strong>Requisitos<\/strong><\/p>/);
  assert.equal(detail.salary, '20.000 € – 26.000 €/año');
  assert.equal(detail.workday, 'Completa');
  assert.equal(detail.minimumStudies, 'Grado');
  assert.equal(detail.minimumExperience, '2 años');
  assert.deepEqual(detail.requiredLanguages, ['Inglés B2', 'Español']);
});
