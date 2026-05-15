const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));
const cheerio = require('cheerio');

const PAGESPEED_API = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';
const PAGESPEED_KEY = process.env.PAGESPEED_API_KEY || '';

async function fetchPageSpeed(url, strategy) {
  const params = new URLSearchParams({ url, strategy, category: 'performance' });
  if (PAGESPEED_KEY) params.set('key', PAGESPEED_KEY);
  const resp = await fetch(`${PAGESPEED_API}?${params}`, { timeout: 30000 });
  if (!resp.ok) throw new Error(`PageSpeed API error: ${resp.status}`);
  return resp.json();
}

async function fetchHtml(url) {
  const resp = await fetch(url, {
    timeout: 15000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; AlmaWebsiteScorer/1.0; +https://almadigitalservices.com)'
    }
  });
  const html = await resp.text();
  const finalUrl = resp.url;
  const headers = Object.fromEntries(resp.headers.entries());
  return { html, finalUrl, headers, status: resp.status };
}

function scorePerformance(psiData) {
  const cats = psiData?.lighthouseResult?.categories;
  const perf = cats?.performance?.score;
  if (perf == null) return { score: 50, findings: ['Could not retrieve performance data'] };

  const score = Math.round(perf * 100);
  const audits = psiData?.lighthouseResult?.audits || {};
  const findings = [];

  const fcp = audits['first-contentful-paint']?.displayValue;
  const lcp = audits['largest-contentful-paint']?.displayValue;
  const tbt = audits['total-blocking-time']?.displayValue;
  const cls = audits['cumulative-layout-shift']?.displayValue;

  if (fcp) findings.push(`First Contentful Paint: ${fcp}`);
  if (lcp) findings.push(`Largest Contentful Paint: ${lcp}`);
  if (tbt) findings.push(`Total Blocking Time: ${tbt}`);
  if (cls) findings.push(`Layout Shift: ${cls}`);

  if (score < 50) findings.push('Page loads very slowly — visitors are likely leaving before it finishes');
  else if (score < 70) findings.push('Page speed needs improvement');
  else if (score >= 90) findings.push('Excellent performance');

  return { score, findings };
}

function scoreMobile(psiMobileData) {
  const cats = psiMobileData?.lighthouseResult?.categories;
  const perf = cats?.performance?.score;
  if (perf == null) return { score: 50, findings: ['Could not retrieve mobile data'] };

  const score = Math.round(perf * 100);
  const audits = psiMobileData?.lighthouseResult?.audits || {};
  const findings = [];

  const viewport = audits['viewport']?.score;
  const tapTargets = audits['tap-targets']?.score;

  if (viewport === 0) findings.push('Missing viewport meta tag — site not optimized for mobile');
  if (tapTargets === 0) findings.push('Tap targets too small for mobile users');
  if (score < 50) findings.push('Poor mobile experience — most visitors browse on phone');
  else if (score >= 90) findings.push('Excellent mobile experience');

  return { score, findings };
}

function scoreSEO($, finalUrl) {
  const findings = [];
  let score = 0;

  // Title tag (15 pts)
  const title = $('title').text().trim();
  if (title) {
    score += 15;
    if (title.length > 60) findings.push(`Title tag is too long (${title.length} chars, aim for <60)`);
  } else {
    findings.push('Missing title tag — critical for search rankings');
  }

  // Meta description (12 pts)
  const metaDesc = $('meta[name="description"]').attr('content');
  if (metaDesc) {
    score += 12;
    if (metaDesc.length > 160) findings.push('Meta description is too long (aim for <160 chars)');
  } else {
    findings.push('Missing meta description — affects click-through rates from search');
  }

  // H1 (10 pts)
  const h1s = $('h1');
  if (h1s.length === 1) {
    score += 10;
  } else if (h1s.length === 0) {
    findings.push('Missing H1 heading');
  } else {
    score += 5;
    findings.push(`Multiple H1 tags found (${h1s.length}) — use only one`);
  }

  // Alt text on images (10 pts)
  const imgs = $('img');
  const imgsWithoutAlt = imgs.filter((_, el) => !$(el).attr('alt'));
  if (imgs.length === 0 || imgsWithoutAlt.length === 0) {
    score += 10;
  } else {
    const ratio = (imgs.length - imgsWithoutAlt.length) / imgs.length;
    score += Math.round(ratio * 10);
    findings.push(`${imgsWithoutAlt.length} of ${imgs.length} images missing alt text`);
  }

  // Canonical (8 pts)
  if ($('link[rel="canonical"]').length > 0) {
    score += 8;
  } else {
    findings.push('No canonical URL tag — may cause duplicate content issues');
  }

  // Open Graph (10 pts)
  const ogTitle = $('meta[property="og:title"]').attr('content');
  const ogDesc = $('meta[property="og:description"]').attr('content');
  if (ogTitle && ogDesc) {
    score += 10;
  } else {
    findings.push('Missing Open Graph tags — affects social media sharing appearance');
  }

  // Structured data (10 pts)
  const jsonLd = $('script[type="application/ld+json"]');
  if (jsonLd.length > 0) {
    score += 10;
  } else {
    findings.push('No structured data (JSON-LD) — missing rich snippet opportunities');
  }

  // HTTPS check (15 pts)
  if (finalUrl.startsWith('https://')) {
    score += 15;
  } else {
    findings.push('Site not using HTTPS — hurts search rankings and trust');
  }

  // Robots meta (5 pts)
  const robotsMeta = $('meta[name="robots"]').attr('content');
  if (!robotsMeta || (!robotsMeta.includes('noindex') && !robotsMeta.includes('nofollow'))) {
    score += 5;
  } else {
    findings.push('Robots meta is blocking search engines from indexing pages');
  }

  // Sitemap link (5 pts)
  const sitemapLink = $('link[rel="sitemap"]').length;
  if (sitemapLink > 0) {
    score += 5;
  }

  if (findings.length === 0) findings.push('SEO fundamentals are solid');

  return { score: Math.min(100, score), findings };
}

function scoreSecurity(headers, finalUrl) {
  const findings = [];
  let score = 0;

  // HTTPS (30 pts)
  if (finalUrl.startsWith('https://')) {
    score += 30;
  } else {
    findings.push('Not using HTTPS — data transmitted insecurely');
  }

  // HSTS (20 pts)
  if (headers['strict-transport-security']) {
    score += 20;
  } else {
    findings.push('Missing HSTS header — browsers may fall back to HTTP');
  }

  // X-Content-Type-Options (15 pts)
  if (headers['x-content-type-options']) {
    score += 15;
  } else {
    findings.push('Missing X-Content-Type-Options header');
  }

  // X-Frame-Options (15 pts)
  if (headers['x-frame-options']) {
    score += 15;
  } else {
    findings.push('Missing X-Frame-Options header — vulnerable to clickjacking');
  }

  // Content-Security-Policy (10 pts)
  if (headers['content-security-policy']) {
    score += 10;
  }

  // Referrer-Policy (10 pts)
  if (headers['referrer-policy']) {
    score += 10;
  }

  if (findings.length === 0) findings.push('Strong security headers in place');

  return { score: Math.min(100, score), findings };
}

function scoreConversion($) {
  const findings = [];
  let score = 0;
  const html = $.html().toLowerCase();

  // CTA buttons (20 pts)
  const ctaKeywords = ['get started', 'contact us', 'free', 'schedule', 'book', 'call', 'quote', 'learn more', 'sign up'];
  const hasCTA = ctaKeywords.some(kw => html.includes(kw));
  if (hasCTA) {
    score += 20;
  } else {
    findings.push('No clear call-to-action found — visitors may not know what to do next');
  }

  // Contact form (20 pts)
  const hasForm = $('form').length > 0;
  if (hasForm) {
    score += 20;
  } else {
    findings.push('No contact form detected — harder for leads to reach you');
  }

  // Phone number (15 pts)
  const phoneRegex = /(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/;
  if (phoneRegex.test(html)) {
    score += 15;
  } else {
    findings.push('No phone number visible — reduces trust and accessibility');
  }

  // Email address (10 pts)
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
  const emailOrMailto = emailRegex.test(html) || html.includes('mailto:');
  if (emailOrMailto) {
    score += 10;
  }

  // Social media links (10 pts)
  const socialLinks = ['facebook.com', 'instagram.com', 'twitter.com', 'x.com', 'linkedin.com'];
  const hasSocial = socialLinks.some(s => html.includes(s));
  if (hasSocial) {
    score += 10;
  } else {
    findings.push('No social media links — missed trust-building opportunity');
  }

  // Navigation (15 pts)
  const hasNav = $('nav').length > 0 || $('header ul').length > 0;
  if (hasNav) {
    score += 15;
  } else {
    findings.push('Navigation structure unclear — visitors may struggle to find information');
  }

  // Above-fold CTA check (10 pts) — heuristic: CTA keyword in first 2000 chars
  const firstSection = html.slice(0, 2000);
  if (ctaKeywords.some(kw => firstSection.includes(kw))) {
    score += 10;
  } else {
    findings.push('No call-to-action visible above the fold');
  }

  if (findings.length === 0) findings.push('Good conversion elements in place');

  return { score: Math.min(100, score), findings };
}

function calculateOverall(dimensions) {
  const weights = { performance: 0.25, mobile: 0.20, seo: 0.25, security: 0.15, conversion: 0.15 };
  let total = 0;
  for (const [key, weight] of Object.entries(weights)) {
    total += (dimensions[key]?.score || 0) * weight;
  }
  return Math.round(total);
}

function getLetterGrade(score) {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}

async function scoreWebsite(url) {
  // Run all checks in parallel for speed
  const [psiDesktop, psiMobile, htmlResult] = await Promise.allSettled([
    fetchPageSpeed(url, 'desktop'),
    fetchPageSpeed(url, 'mobile'),
    fetchHtml(url)
  ]);

  const html = htmlResult.status === 'fulfilled' ? htmlResult.value.html : '';
  const finalUrl = htmlResult.status === 'fulfilled' ? htmlResult.value.finalUrl : url;
  const headers = htmlResult.status === 'fulfilled' ? htmlResult.value.headers : {};

  const $ = cheerio.load(html);

  const psiDesktopData = psiDesktop.status === 'fulfilled' ? psiDesktop.value : null;
  const psiMobileData = psiMobile.status === 'fulfilled' ? psiMobile.value : null;

  const dimensions = {
    performance: scorePerformance(psiDesktopData),
    mobile: scoreMobile(psiMobileData),
    seo: scoreSEO($, finalUrl),
    security: scoreSecurity(headers, finalUrl),
    conversion: scoreConversion($)
  };

  const overallScore = calculateOverall(dimensions);
  const letterGrade = getLetterGrade(overallScore);

  return {
    overallScore,
    letterGrade,
    dimensions,
    isHighPain: letterGrade === 'F' || letterGrade === 'D',
    scoredAt: new Date().toISOString()
  };
}

module.exports = { scoreWebsite };
