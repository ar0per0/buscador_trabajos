const test = require('node:test');
const assert = require('node:assert/strict');
const { buildSearchUrl, normalize, parseDetail } = require('../scrape_feinaactiva');

test('construye y valida búsquedas de Feina Activa', () => {
  assert.match(buildSearchUrl({ keyword: 'it', city: 'Girona' }), /keywords=it\+Girona/);
  assert.equal(buildSearchUrl({ url: 'https://feinaactiva.gencat.cat/es/search/offers/list?keywords=it' }), 'https://feinaactiva.gencat.cat/es/search/offers/list?keywords=it');
  assert.throws(() => buildSearchUrl({ url: 'https://feinaactiva.gencat.cat/es/home' }), /listado/);
});

test('normaliza ofertas propias y convocatorias externas', () => {
  const internal = normalize({ url: '/es/search/offers/detail/FA123', title: 'Técnico/a IT', company: 'Empresa', location: 'Girona' });
  assert.equal(internal.source_id, 'FA123');
  assert.equal(internal.feinaActivaDetailLoaded, false);
  const external = normalize({ url: 'https://cido.diba.cat/oposicions/123', title: 'Técnico/a' });
  assert.equal(external.url, 'https://cido.diba.cat/oposicions/123');
  assert.equal(external.feinaActivaDetailLoaded, true);
});

test('extrae descripción, requisitos y condiciones del detalle', () => {
  const html = '<fa-extra-description><h3>Descripción de la oferta</h3><p>Descripción completa\n\n- Primera función\n- Segunda función</p></fa-extra-description><fa-extra-description><h3>Requisitos</h3><ul><li>Experiencia 2 años.</li><li>ESTUDIOS PRIMARIOS COMPLETOS</li></ul></fa-extra-description><fa-extra-description><h3>Condiciones del puesto de trabajo</h3><ul><li>Contrato laboral indefinido</li><li>Jornada completa</li><li>Salario mensual bruto 30000</li><li>Otros datos de interés: Te ofrecemos: Jornada flexible y beneficios</li></ul></fa-extra-description>';
  const detail = parseDetail(html);
  assert.match(detail.description, /^Descripción completa/);
  assert.match(detail.descriptionHtml, /<ul><li>Primera función<\/li>/);
  assert.match(detail.minimumExperience, /2 años/);
  assert.equal(detail.minimumStudies, 'ESTUDIOS PRIMARIOS COMPLETOS');
  assert.match(detail.workday, /completa/);
  assert.match(detail.salary, /30000/);
  assert.doesNotMatch(detail.workday, /Te ofrecemos/);
  assert.equal(detail.contractType, 'Contrato laboral indefinido');
});
