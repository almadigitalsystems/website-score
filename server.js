const express = require('express');
const path = require('path');
const { scoreWebsite } = require('./scorer');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/score', async (req, res) => {
  const { url, email } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  let targetUrl = url.trim();
  if (!/^https?:\/\//i.test(targetUrl)) {
    targetUrl = 'https://' + targetUrl;
  }

  try {
    new URL(targetUrl);
  } catch {
    return res.status(400).json({ error: 'Invalid URL format' });
  }

  try {
    const results = await scoreWebsite(targetUrl);

    if (email && typeof email === 'string' && email.includes('@')) {
      logLead(email, targetUrl, results).catch(() => {});
    }

    res.json(results);
  } catch (err) {
    console.error('Scoring error:', err.message);
    res.status(502).json({
      error: 'Unable to analyze this website. Please check the URL and try again.'
    });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

async function logLead(email, url, results) {
  const entry = `${new Date().toISOString()} | ${email} | ${url} | Grade: ${results.overall.grade} (${results.overall.score}/100)`;
  console.log(`LEAD: ${entry}`);
}

app.listen(PORT, () => {
  console.log(`Website Score running on port ${PORT}`);
});
