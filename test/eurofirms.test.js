const test = require('node:test');
const assert = require('node:assert/strict');
const { buildSearchUrl, detailFromPosting, parseDetail, parseJobPosting, parseListing } = require('../scrape_eurofirms');

test('construye y valida búsquedas de Eurofirms', () => {
  assert.match(buildSearchUrl({ keyword: 'it', city: 'Girona' }), /\/trabajo\/girona\?search=it/);
  assert.match(buildSearchUrl({ url: 'https://jobs.eurofirms.com/es/es/trabajo/girona?search=it' }), /eurofirms\.com/);
  assert.throws(() => buildSearchUrl({ url: 'https://jobs.eurofirms.com/es/es/candidatos' }), /listado/);
});

test('normaliza una tarjeta de Eurofirms', () => {
  const html = `<span>1 resultados</span><div id="offers-cards"><a href='/es/es/girona/programador-a-001-045271'><article psf-offer data-ordercode="001-045271"><span>¡Nueva!</span><h3 class="psf-offer__title">Programador/a</h3><h4 class="psf-offer__site">girona, girona</h4><p class="psf-offer__description">Descripción</p><div class="psf-offer__salary">Salario a concretar</div><span>19/08/2026</span></article></a></div><nav id="paginationNumbers"></nav>`;
  const result = parseListing(html);
  assert.equal(result.total, 1);
  assert.equal(result.jobs[0].source_id, '001-045271');
  assert.equal(result.jobs[0].title, 'Programador/a');
  assert.equal(result.jobs[0].urgent, true);
});

test('extrae el detalle JobPosting de Eurofirms', () => {
  const posting = parseJobPosting('<script type="application/ld+json">{"@type":"JobPosting","description":"<p>Completa</p>","hiringOrganization":{"name":"EUROFIRMS GROUP"},"jobLocation":{"address":{"addressLocality":"GIRONA","addressRegion":"GIRONA"}},"workHours":"40 horas"}</script>');
  const detail = detailFromPosting(posting);
  assert.equal(detail.description, 'Completa');
  assert.equal(detail.location, 'GIRONA');
  assert.equal(detail.workday, '40 horas');
  assert.equal(detail.descriptionHtml, '<p>Completa</p>');
});

test('conserva el formato y separa los bloques visibles del detalle', () => {
  const posting = '<script type="application/ld+json">{"@type":"JobPosting","description":"<p>Presentación</p><ul><li>Tarea uno</li></ul>","baseSalary":{"value":{"value":"A convenir"}}}</script>';
  const field = (label, value) => `<h4>${label}:</h4><span>${value}</span>`;
  const detail = parseDetail(posting + field('Horario', 'Jornada completa de 40 horas') + field('Salario', 'A concretar') + field('Formación', '- ESO finalizada.') + field('Idiomas', 'Catalán y castellano correctamente.') + field('Experiencia mínima', '1 año'));
  assert.match(detail.descriptionHtml, /<ul><li>Tarea uno<\/li><\/ul>/);
  assert.equal(detail.workday, 'Jornada completa de 40 horas');
  assert.equal(detail.salary, 'A concretar');
  assert.equal(detail.minimumStudies, 'ESO finalizada.');
  assert.equal(detail.minimumExperience, '1 año');
  assert.deepEqual(detail.requiredLanguages, ['Catalán y castellano correctamente.']);
});
