const test = require('node:test');
const assert = require('node:assert/strict');
const { buildSearchUrl, parseDetail, parseListing } = require('../scrape_infofeina');

test('construye y valida búsquedas de Infofeina', () => {
  assert.match(buildSearchUrl({ keyword: 'it', city: 'Girona' }), /title=it&location=Girona&radius=30/);
  assert.throws(() => buildSearchUrl({ url: 'https://www.infofeina.com/empreses' }), /listado/);
});

test('normaliza una oferta del listado', () => {
  const html = '<h2>Hem trobat 1 ofertes</h2><div class="offers-list"><div class="post-wrapper job_image_sec"><a href="https://www.infofeina.com/ofertes/programador" class="job_title">Programador/a</a><a class="company_title"><span>Empresa</span></a><p class="job_location">Girona</p><p class="job_description">Descripció</p><p class="job_tag">03/09/2026</p><p class="job_tag time">Jornada completa</p></div>';
  const result = parseListing(html);
  assert.equal(result.jobs.length, 1);
  assert.equal(result.jobs[0].source_id, 'programador');
  assert.equal(result.jobs[0].company, 'Empresa');
});

test('extrae el detalle HTML', () => {
  const html = '<div class="latest-search-sec"><p class="description-detail">Descripció completa</p><p class="condition-title">Jornada</p><p class="condition-desc">Jornada completa</p><p class="condition-title">Salari</p><p class="condition-desc">30.000 €</p></div>';
  const detail = parseDetail(html);
  assert.equal(detail.description, 'Descripció completa');
  assert.equal(detail.workday, 'Jornada completa');
  assert.equal(detail.salary, '30.000 €');
});

test('conserva formato y limpia los bloques principales del detalle', () => {
  const html = `<div class="latest-search-sec"><div class="description-detail-wrap"><p class="description-detail">Primera línia<br><br><strong>Important</strong></p></div><div class="description-detail-wrap formation-box"><p class="detail-rgt">-ESO amb titulació ESO</p></div><div class="description-detail-wrap experience-box"><p class="title-lft">Nivell d&apos;experiència</p><p class="detail-rgt">Personal qualificat</p><p class="title-lft">Anys d&apos;experiència</p><p class="detail-rgt">2 anys</p></div><div class="description-detail-wrap lang-wrap"><p class="language_skill">Català</p><p class="percent-status">C1<span></span></p></div><div class="other-information"></div></div>`;
  const detail = parseDetail(html);
  assert.match(detail.descriptionHtml, /Primera línia<br><br><strong>Important<\/strong>/);
  assert.equal(detail.minimumStudies, '-ESO amb titulació ESO');
  assert.doesNotMatch(detail.minimumStudies, /class=|<p/);
  assert.equal(detail.minimumExperience, '2 anys · Personal qualificat');
  assert.deepEqual(detail.requiredLanguages, ['Català: C1']);
});

test('no toma la jornada de ofertas recomendadas', () => {
  const html = '<div class="latest-search-sec"><p class="description-detail">Oferta principal</p></div><p class="condition-title">Tipus de contracte</p><p class="condition-desc">Temporal</p><div class="other-offers"><p class="job_tag time">Indiferent</p></div>';
  const detail = parseDetail(html);
  assert.equal(detail.workday, 'Temporal');
  assert.doesNotMatch(detail.workday, /Indiferent/);
});
