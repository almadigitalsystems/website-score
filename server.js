const express = require('express');
const cors = require('cors');
const path = require('path');
const { scoreWebsite } = require('./scorer');
const { sendLeadNotification } = require('./mailer');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;

// In-memory result store (results expire after 24h)
const results = new Map();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Health check
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// Score endpoint
app.post('/api/score', async (req, res) => {
  const { url, email } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  // Normalize URL
  let targetUrl = url.trim();
  if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
    targetUrl = 'https://' + targetUrl;
  }

  try {
    const scoreData = await scoreWebsite(targetUrl);
    const id = uuidv4();

    // Store result
    results.set(id, {
      ...scoreData,
      url: targetUrl,
      email: email || null,
      createdAt: Date.now()
    });

    // Send lead notification if email provided
    if (email && (scoreData.letterGrade === 'F' || scoreData.letterGrade === 'D')) {
      sendLeadNotification(email, targetUrl, scoreData).catch(console.error);
    } else if (email) {
      sendLeadNotification(email, targetUrl, scoreData).catch(console.error);
    }

    res.json({ id, ...scoreData });
  } catch (err) {
    console.error('Scoring error:', err.message);
    res.status(500).json({ error: 'Unable to analyze this website. Please check the URL and try again.' });
  }
});

// Get result by ID
app.get('/api/result/:id', (req, res) => {
  const result = results.get(req.params.id);
  if (!result) {
    return res.status(404).json({ error: 'Result not found' });
  }
  res.json(result);
});

// Serve landing page for all other routes (SPA)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Clean up expired results every hour
setInterval(() => {
  const now = Date.now();
  for (const [id, result] of results.entries()) {
    if (now - result.createdAt > 24 * 60 * 60 * 1000) {
      results.delete(id);
    }
  }
}, 60 * 60 * 1000);

app.listen(PORT, () => {
  console.log(`ALM Website Score running on port ${PORT}`);
});
