const cheerio = require('cheerio');

const PAGESPEED_API = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';

async function scoreWebsite(url) {
  const [psDesktop, psMobile, htmlData] = await Promise.all([
    fetchPageSpeed(url, 'desktop'),
    fetchPageSpeed(url, 'mobile'),
    fetchHtml(url)
  ]);

  const performance = scorePerformance(psDesktop);
  const mobile = scoreMobile(psMobile);
  const seo = scoreSeo(htmlData);
  const security = scoreSecurity(htmlData);
  const conversion = scoreConversion(htmlData);

  const weighted = Math.round(
    performance.score * 0.25 +
    mobile.score * 0.20 +
    seo.score * 0.25 +
    security.score * 0.15 +
    conversion.score * 0.15
  );

  return {
    url,
    overall: { score: weighted, grade: grade(weighted) },
    dimensions: { performance, mobile, seo, security, conversion },
    analyzedAt: new Date().toISOString()
  };
}

async function fetchPageSpeed(url, strategy) {
  try {
    const params = new URLSearchParams({
      url,
      strategy,
      category: 'performance'
    });
    const res = await fetch(`${PAGESPEED_API}?${params}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.error(`PageSpeed ${strategy}:`, err.message);
    return null;
  }
}

async function fetchHtml(url) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AlmaScoreBot/1.0)' },
      redirect: 'follow'
    });
    clearTimeout(timeout);
    const html = await res.text();
    const headers = {};
    res.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });
    return {
      $: cheerio.load(html),
      html,
      headers,
      isHttps: res.url.startsWith('https://')
    };
  } catch (err) {
    console.error('HTML fetch:', err.message);
    return null;
  }
}

function scorePerformance(ps) {
  const findings = [];
  let score = 50;

  if (ps?.lighthouseResult) {
    const lhr = ps.lighthouseResult;
    score = Math.round((lhr.categories?.performance?.score ?? 0.5) * 100);
    const a = lhr.audits || {};

    for (const [key, label] of [
      ['first-contentful-paint', 'First Contentful Paint'],
      ['largest-contentful-paint', 'Largest Contentful Paint'],
      ['total-blocking-time', 'Total Blocking Time'],
      ['cumulative-layout-shift', 'Cumulative Layout Shift'],
      ['speed-index', 'Speed Index']
    ]) {
      if (a[key]) {
        findings.push({ label, value: a[key].displayValue || '', pass: a[key].score >= 0.9 });
      }
    }
  } else {
    findings.push({ label: 'PageSpeed data', value: 'Unavailable', pass: false });
  }

  return { score, grade: grade(score), findings, label: 'Performance' };
}

function scoreMobile(ps) {
  const findings = [];
  let score = 50;

  if (ps?.lighthouseResult) {
    const lhr = ps.lighthouseResult;
    score = Math.round((lhr.categories?.performance?.score ?? 0.5) * 100);
    const a = lhr.audits || {};

    if (a.viewport) findings.push({ label: 'Viewport Meta', value: a.viewport.score >= 0.5 ? 'Present' : 'Missing', pass: a.viewport.score >= 0.5 });
    if (a['first-contentful-paint']) findings.push({ label: 'Mobile FCP', value: a['first-contentful-paint'].displayValue || '', pass: a['first-contentful-paint'].score >= 0.9 });
    if (a.interactive) findings.push({ label: 'Time to Interactive', value: a.interactive.displayValue || '', pass: a.interactive.score >= 0.9 });
  } else {
    findings.push({ label: 'Mobile data', value: 'Unavailable', pass: false });
  }

  return { score, grade: grade(score), findings, label: 'Mobile' };
}

function scoreSeo(htmlData) {
  const findings = [];
  let pts = 0;

  if (!htmlData?.$) {
    return { score: 0, grade: 'F', findings: [{ label: 'HTML', value: 'Unavailable', pass: false }], label: 'SEO' };
  }

  const $ = htmlData.$;

  const title = $('title').text().trim();
  if (title) {
    const ok = title.length >= 10 && title.length <= 70;
    pts += ok ? 15 : 8;
    findings.push({ label: 'Title Tag', value: `${title.length} chars${ok ? '' : title.length > 70 ? ' (too long)' : ' (too short)'}`, pass: ok });
  } else {
    findings.push({ label: 'Title Tag', value: 'Missing', pass: false });
  }

  const desc = $('meta[name="description"]').attr('content')?.trim();
  if (desc) {
    const ok = desc.length >= 50 && desc.length <= 160;
    pts += ok ? 15 : 8;
    findings.push({ label: 'Meta Description', value: `${desc.length} chars${ok ? '' : desc.length > 160 ? ' (too long)' : ' (too short)'}`, pass: ok });
  } else {
    findings.push({ label: 'Meta Description', value: 'Missing', pass: false });
  }

  const h1s = $('h1').length;
  if (h1s === 1) { pts += 12; findings.push({ label: 'H1 Tag', value: '1 found', pass: true }); }
  else if (h1s > 1) { pts += 6; findings.push({ label: 'H1 Tag', value: `${h1s} found (should be 1)`, pass: false }); }
  else { findings.push({ label: 'H1 Tag', value: 'Missing', pass: false }); }

  if ($('h2').length > 0) { pts += 8; findings.push({ label: 'Heading Structure', value: 'H2 tags present', pass: true }); }
  else { findings.push({ label: 'Heading Structure', value: 'No H2 tags', pass: false }); }

  const imgs = $('img').length;
  const alts = $('img[alt]').filter((_, el) => $(el).attr('alt').trim().length > 0).length;
  if (imgs === 0) { pts += 12; findings.push({ label: 'Image Alt Text', value: 'No images', pass: true }); }
  else {
    const r = alts / imgs;
    pts += Math.round(r * 12);
    findings.push({ label: 'Image Alt Text', value: `${alts}/${imgs} have alt text`, pass: r >= 0.8 });
  }

  if ($('link[rel="canonical"]').attr('href')) { pts += 8; findings.push({ label: 'Canonical URL', value: 'Present', pass: true }); }
  else { findings.push({ label: 'Canonical URL', value: 'Missing', pass: false }); }

  const og = [$('meta[property="og:title"]').attr('content'), $('meta[property="og:description"]').attr('content'), $('meta[property="og:image"]').attr('content')].filter(Boolean).length;
  pts += Math.round((og / 3) * 10);
  findings.push({ label: 'Open Graph', value: `${og}/3 tags`, pass: og >= 2 });

  if ($('script[type="application/ld+json"]').length) { pts += 10; findings.push({ label: 'Structured Data', value: 'JSON-LD found', pass: true }); }
  else { findings.push({ label: 'Structured Data', value: 'None', pass: false }); }

  const noindex = ($('meta[name="robots"]').attr('content') || '').includes('noindex');
  if (!noindex) { pts += 5; findings.push({ label: 'Indexability', value: 'Indexable', pass: true }); }
  else { findings.push({ label: 'Indexability', value: 'Blocked (noindex)', pass: false }); }

  if ($('html').attr('lang')) { pts += 5; findings.push({ label: 'Language', value: $('html').attr('lang'), pass: true }); }
  else { findings.push({ label: 'Language', value: 'Missing', pass: false }); }

  return { score: Math.min(pts, 100), grade: grade(Math.min(pts, 100)), findings, label: 'SEO' };
}

function scoreSecurity(htmlData) {
  const findings = [];
  let pts = 0;

  if (!htmlData) {
    return { score: 0, grade: 'F', findings: [{ label: 'Security', value: 'Unavailable', pass: false }], label: 'Security' };
  }

  if (htmlData.isHttps) { pts += 35; findings.push({ label: 'HTTPS', value: 'Enabled', pass: true }); }
  else { findings.push({ label: 'HTTPS', value: 'Not enabled', pass: false }); }

  const h = htmlData.headers;

  if (h['strict-transport-security']) { pts += 20; findings.push({ label: 'HSTS', value: 'Present', pass: true }); }
  else { findings.push({ label: 'HSTS', value: 'Missing', pass: false }); }

  if (h['x-content-type-options']?.includes('nosniff')) { pts += 10; findings.push({ label: 'X-Content-Type-Options', value: 'nosniff', pass: true }); }
  else { findings.push({ label: 'X-Content-Type-Options', value: 'Missing', pass: false }); }

  if (h['x-frame-options']) { pts += 10; findings.push({ label: 'X-Frame-Options', value: h['x-frame-options'], pass: true }); }
  else { findings.push({ label: 'X-Frame-Options', value: 'Missing', pass: false }); }

  if (h['content-security-policy']) { pts += 15; findings.push({ label: 'Content-Security-Policy', value: 'Present', pass: true }); }
  else { findings.push({ label: 'Content-Security-Policy', value: 'Missing', pass: false }); }

  if (h['referrer-policy']) { pts += 10; findings.push({ label: 'Referrer-Policy', value: h['referrer-policy'], pass: true }); }
  else { findings.push({ label: 'Referrer-Policy', value: 'Missing', pass: false }); }

  return { score: Math.min(pts, 100), grade: grade(Math.min(pts, 100)), findings, label: 'Security' };
}

function scoreConversion(htmlData) {
  const findings = [];
  let pts = 0;

  if (!htmlData?.$) {
    return { score: 0, grade: 'F', findings: [{ label: 'Conversion', value: 'Unavailable', pass: false }], label: 'Conversion' };
  }

  const $ = htmlData.$;
  const text = htmlData.html.toLowerCase();

  const btns = $('button, a.btn, a.button, [class*="cta"], [class*="btn"]');
  if (btns.length > 0) { pts += 20; findings.push({ label: 'CTA Buttons', value: `${btns.length} found`, pass: true }); }
  else { findings.push({ label: 'CTA Buttons', value: 'None found', pass: false }); }

  if ($('form').length > 0) { pts += 20; findings.push({ label: 'Contact Form', value: 'Present', pass: true }); }
  else { findings.push({ label: 'Contact Form', value: 'None', pass: false }); }

  const hasPhone = /(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/.test(text) || $('a[href^="tel:"]').length > 0;
  if (hasPhone) { pts += 15; findings.push({ label: 'Phone Number', value: 'Visible', pass: true }); }
  else { findings.push({ label: 'Phone Number', value: 'Not found', pass: false }); }

  const hasEmail = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/.test(text) || $('a[href^="mailto:"]').length > 0;
  if (hasEmail) { pts += 10; findings.push({ label: 'Email', value: 'Visible', pass: true }); }
  else { findings.push({ label: 'Email', value: 'Not found', pass: false }); }

  const socialLinks = $('a').filter((_, el) => /facebook\.com|twitter\.com|x\.com|linkedin\.com|instagram\.com|youtube\.com/i.test($(el).attr('href') || ''));
  if (socialLinks.length > 0) { pts += 10; findings.push({ label: 'Social Links', value: `${socialLinks.length} found`, pass: true }); }
  else { findings.push({ label: 'Social Links', value: 'None', pass: false }); }

  if ($('nav, [role="navigation"]').length > 0) { pts += 15; findings.push({ label: 'Navigation', value: 'Present', pass: true }); }
  else { findings.push({ label: 'Navigation', value: 'Missing', pass: false }); }

  if (/testimonial|review|rating|certified|award|guarantee/i.test(text)) { pts += 10; findings.push({ label: 'Trust Signals', value: 'Found', pass: true }); }
  else { findings.push({ label: 'Trust Signals', value: 'None detected', pass: false }); }

  return { score: Math.min(pts, 100), grade: grade(Math.min(pts, 100)), findings, label: 'Conversion' };
}

function grade(score) {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}

module.exports = { scoreWebsite };
