const form = document.getElementById('score-form');
const urlInput = document.getElementById('url-input');
const emailInput = document.getElementById('email-input');
const scoreBtn = document.getElementById('score-btn');
const heroSection = document.getElementById('hero');
const loadingSection = document.getElementById('loading');
const resultsSection = document.getElementById('results');
const errorSection = document.getElementById('error');
const loadingStatus = document.getElementById('loading-status');
const progressFill = document.getElementById('progress-fill');

const statusMessages = [
  'Running performance checks...',
  'Testing mobile responsiveness...',
  'Analyzing SEO signals...',
  'Checking security headers...',
  'Evaluating conversion elements...',
  'Calculating your score...'
];

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const url = urlInput.value.trim();
  if (!url) return;

  show('loading');
  animateProgress();

  try {
    const res = await fetch('/api/score', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, email: emailInput.value.trim() || undefined })
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Analysis failed');
    }

    const data = await res.json();
    renderResults(data);
    show('results');
  } catch (err) {
    document.getElementById('error-message').textContent = err.message;
    show('error');
  }
});

document.getElementById('rescan-btn').addEventListener('click', () => {
  urlInput.value = '';
  emailInput.value = '';
  show('hero');
  urlInput.focus();
});

document.getElementById('retry-btn').addEventListener('click', () => {
  show('hero');
  urlInput.focus();
});

function show(section) {
  heroSection.classList.toggle('hidden', section !== 'hero');
  loadingSection.classList.toggle('hidden', section !== 'loading');
  resultsSection.classList.toggle('hidden', section !== 'results');
  errorSection.classList.toggle('hidden', section !== 'error');
  if (section === 'results' || section === 'error') {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

function animateProgress() {
  progressFill.style.width = '0%';
  let i = 0;
  const interval = setInterval(() => {
    if (i < statusMessages.length) {
      loadingStatus.textContent = statusMessages[i];
      progressFill.style.width = `${((i + 1) / statusMessages.length) * 90}%`;
      i++;
    } else {
      clearInterval(interval);
    }
  }, 2500);

  const observer = new MutationObserver(() => {
    if (loadingSection.classList.contains('hidden')) {
      clearInterval(interval);
      observer.disconnect();
    }
  });
  observer.observe(loadingSection, { attributes: true, attributeFilter: ['class'] });
}

function renderResults(data) {
  document.getElementById('grade-letter').textContent = data.overall.grade;
  document.getElementById('score-number').textContent = data.overall.score;
  document.getElementById('score-url').textContent = data.url;

  const circle = document.getElementById('grade-circle');
  circle.className = 'grade-circle grade-' + data.overall.grade.toLowerCase();

  const dims = document.getElementById('dimensions');
  dims.innerHTML = '';

  for (const [key, dim] of Object.entries(data.dimensions)) {
    const card = document.createElement('div');
    card.className = 'dim-card';
    card.innerHTML = `
      <div class="dim-header">
        <div class="dim-grade grade-${dim.grade.toLowerCase()}">${dim.grade}</div>
        <div class="dim-info">
          <h3>${dim.label}</h3>
          <span class="dim-score">${dim.score}/100</span>
        </div>
        <button class="dim-toggle" aria-label="Toggle details">&#9660;</button>
      </div>
      <div class="dim-details hidden">
        <ul>
          ${dim.findings.map(f => `
            <li class="${f.pass ? 'pass' : 'fail'}">
              <span class="check">${f.pass ? '&#10003;' : '&#10007;'}</span>
              <span class="finding-label">${f.label}</span>
              <span class="finding-value">${f.value}</span>
            </li>
          `).join('')}
        </ul>
      </div>
    `;
    card.querySelector('.dim-toggle').addEventListener('click', function () {
      const details = card.querySelector('.dim-details');
      details.classList.toggle('hidden');
      this.textContent = details.classList.contains('hidden') ? '▼' : '▲';
    });
    dims.appendChild(card);
  }

  const needsRedesign = data.overall.grade === 'D' || data.overall.grade === 'F';
  document.getElementById('cta-redesign').classList.toggle('hidden', !needsRedesign);
}
