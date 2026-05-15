const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: false,
  auth: {
    user: process.env.SMTP_USER || 'desk@almawebcreative.com',
    pass: process.env.SMTP_PASS || ''
  }
});

async function sendLeadNotification(email, url, scoreData) {
  const gradeEmoji = { A: '🟢', B: '🟡', C: '🟠', D: '🔴', F: '🚨' };
  const emoji = gradeEmoji[scoreData.letterGrade] || '⚪';
  const isHighPain = scoreData.isHighPain;

  const subject = isHighPain
    ? `🚨 HIGH-PAIN LEAD: ${url} scored ${scoreData.letterGrade} (${scoreData.overallScore}/100)`
    : `New website score lead: ${url} — Grade ${scoreData.letterGrade}`;

  const dimensionRows = Object.entries(scoreData.dimensions)
    .map(([key, d]) => `<tr><td style="padding:6px;text-transform:capitalize;font-weight:bold">${key}</td><td style="padding:6px">${d.score}/100</td></tr>`)
    .join('');

  const html = `
<h2>${emoji} New Website Score Lead</h2>
<p><strong>Website:</strong> <a href="${url}">${url}</a></p>
<p><strong>Email:</strong> ${email}</p>
<p><strong>Overall Grade:</strong> <span style="font-size:2em;font-weight:bold">${scoreData.letterGrade}</span> (${scoreData.overallScore}/100)</p>

<table border="1" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:16px 0">
  <tr style="background:#f5f5f5"><th style="padding:6px">Dimension</th><th style="padding:6px">Score</th></tr>
  ${dimensionRows}
</table>

${isHighPain ? '<p style="color:red;font-weight:bold">⚡ HIGH-PAIN LEAD — Riley should follow up immediately with managed redesign offer</p>' : ''}

<p style="font-size:0.9em;color:#666">Scored at: ${scoreData.scoredAt}</p>
  `;

  await transporter.sendMail({
    from: 'desk@almawebcreative.com',
    to: 'desk@almawebcreative.com',
    subject,
    html
  });
}

module.exports = { sendLeadNotification };
