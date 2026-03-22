const express = require('express');
const { execSync, exec } = require('child_process');
const { OpenAI } = require('openai');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY || 'agent-browser-secret-2026';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const PROFILES_DIR = '/app/profiles';
const BROWSER_ARGS = '--disable-blink-features=AutomationControlled --no-first-run --no-default-browser-check';
const USER_AGENT = 'Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';

// Auth middleware
function auth(req, res, next) {
  const key = req.headers['x-api-key'] || req.query.apiKey;
  if (key !== API_KEY) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

// Execute agent-browser command
function browserCmd(cmd, profileName, timeoutSec = 90) {
  const profileDir = path.join(PROFILES_DIR, profileName);
  if (!fs.existsSync(profileDir)) fs.mkdirSync(profileDir, { recursive: true });

  const fullCmd = `agent-browser --profile ${profileDir} --args "${BROWSER_ARGS}" --user-agent "${USER_AGENT}" ${cmd}`;
  try {
    const output = execSync(fullCmd, {
      timeout: timeoutSec * 1000,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    // Strip ANSI codes
    return output.replace(/\x1b\[[0-9;]*m/g, '').trim();
  } catch (err) {
    const out = (err.stdout || '') + (err.stderr || '');
    return out.replace(/\x1b\[[0-9;]*m/g, '').trim() || err.message;
  }
}

// Close browser for a profile
function browserClose(profileName) {
  try {
    execSync('agent-browser --close', { timeout: 10000, encoding: 'utf-8' });
  } catch (e) { /* ignore */ }
}

// Generate AI response for a review
function generateReply(review, businessName, businessType, tone) {
  if (!OPENAI_API_KEY) return null;
  const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

  const toneMap = {
    profesional: 'profesional y cordial',
    cercano: 'cercano, cálido y amigable',
    formal: 'formal y respetuoso',
    casual: 'casual y relajado',
  };
  const toneDesc = toneMap[tone] || toneMap.profesional;

  const prompt = `Sos el community manager de "${businessName}" (${businessType}).
Respondé esta reseña de Google con tono ${toneDesc}.
- Si es positiva (4-5 estrellas): agradecé con calidez, mencioná el nombre del cliente.
- Si es negativa (1-2 estrellas): mostrá empatía, ofrecé solución, invitá a contacto privado.
- Si es neutral (3 estrellas): agradecé y preguntá cómo mejorar.
- Máximo 3 oraciones. Sin hashtags. En español argentino natural.

Reseña de ${review.author} (${review.stars} estrellas):
"${review.text}"

Respondé SOLO con el texto de la respuesta, sin comillas ni prefijos.`;

  return openai.chat.completions.create({
    model: OPENAI_MODEL,
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 200,
    temperature: 0.7,
  }).then(r => r.choices[0].message.content.trim());
}

// Health check
app.get('/health', (req, res) => {
  let abVersion = 'unknown';
  try {
    abVersion = execSync('agent-browser --version', { encoding: 'utf-8', timeout: 5000 }).trim();
  } catch (e) { abVersion = 'not found'; }

  let chromeOk = false;
  try {
    execSync('chrome --version', { encoding: 'utf-8', timeout: 5000 });
    chromeOk = true;
  } catch (e) { /* */ }

  res.json({
    status: 'ok',
    agentBrowser: abVersion,
    chrome: chromeOk,
    display: process.env.DISPLAY || 'not set',
    profiles: fs.readdirSync(PROFILES_DIR).filter(f =>
      fs.statSync(path.join(PROFILES_DIR, f)).isDirectory()
    ),
  });
});

// Scan reviews for a business
app.post('/scan', auth, async (req, res) => {
  const { businessName, searchUrl, profileName } = req.body;
  if (!businessName || !profileName) {
    return res.status(400).json({ error: 'businessName and profileName required' });
  }

  const profile = profileName.replace(/[^a-zA-Z0-9_-]/g, '');

  try {
    // Close any existing browser
    browserClose(profile);

    // Navigate to Google search for the business
    const url = searchUrl || `https://www.google.com/search?q=${encodeURIComponent(businessName + ' reseñas')}`;
    console.log(`[${profile}] Navigating to: ${url}`);
    browserCmd(`"navigate to ${url}"`, profile, 30);

    // Wait for page load
    await new Promise(r => setTimeout(r, 5000));

    // Click on reviews tab
    console.log(`[${profile}] Looking for reviews...`);
    const snapshot = browserCmd('"take a snapshot of the page and describe what you see, focusing on any reviews section or panel"', profile, 60);

    // Try to find and extract reviews
    const reviewsData = browserCmd('"look for Google reviews on this page. List ALL reviews that have NOT been replied to. For each unreplied review, extract: author name, star rating, review text. Format as JSON array: [{author, stars, text}]. If no reviews panel visible, say NO_REVIEWS_PANEL. If all reviews have replies, say ALL_REPLIED."', profile, 90);

    console.log(`[${profile}] Reviews result: ${reviewsData.substring(0, 200)}`);

    // Close browser
    browserClose(profile);

    res.json({
      success: true,
      profile,
      businessName,
      raw: reviewsData,
    });
  } catch (err) {
    browserClose(profile);
    res.status(500).json({ error: err.message });
  }
});

// Reply to a specific review
app.post('/reply', auth, async (req, res) => {
  const { businessName, businessType, searchUrl, profileName, review, tone } = req.body;
  if (!businessName || !profileName || !review) {
    return res.status(400).json({ error: 'businessName, profileName, and review required' });
  }

  const profile = profileName.replace(/[^a-zA-Z0-9_-]/g, '');

  try {
    // Generate AI reply
    const aiReply = await generateReply(review, businessName, businessType || 'negocio', tone || 'profesional');
    if (!aiReply) {
      return res.status(500).json({ error: 'Failed to generate AI reply. Check OPENAI_API_KEY.' });
    }

    console.log(`[${profile}] AI reply for ${review.author}: ${aiReply}`);

    // Close any existing browser
    browserClose(profile);

    // Navigate to business reviews
    const url = searchUrl || `https://www.google.com/search?q=${encodeURIComponent(businessName + ' reseñas')}`;
    browserCmd(`"navigate to ${url}"`, profile, 30);
    await new Promise(r => setTimeout(r, 5000));

    // Find the specific review and click reply
    const replyCmd = `"Find the review by '${review.author}' and click the Reply button. Then type the following reply text and submit it: ${aiReply.replace(/"/g, '\\"')}"`;
    const result = browserCmd(replyCmd, profile, 120);

    console.log(`[${profile}] Reply result: ${result.substring(0, 200)}`);

    browserClose(profile);

    res.json({
      success: true,
      profile,
      review: review.author,
      reply: aiReply,
      raw: result,
    });
  } catch (err) {
    browserClose(profile);
    res.status(500).json({ error: err.message });
  }
});

// List profiles
app.get('/profiles', auth, (req, res) => {
  const profiles = fs.readdirSync(PROFILES_DIR).filter(f =>
    fs.statSync(path.join(PROFILES_DIR, f)).isDirectory()
  );
  res.json({ profiles });
});

// Full auto-scan + reply flow for a tenant
app.post('/auto', auth, async (req, res) => {
  const { businessName, businessType, searchUrl, profileName, tone } = req.body;
  if (!businessName || !profileName) {
    return res.status(400).json({ error: 'businessName and profileName required' });
  }

  const profile = profileName.replace(/[^a-zA-Z0-9_-]/g, '');

  try {
    browserClose(profile);

    const url = searchUrl || `https://www.google.com/search?q=${encodeURIComponent(businessName + ' reseñas')}`;
    console.log(`[${profile}] AUTO: Navigating to ${url}`);
    browserCmd(`"navigate to ${url}"`, profile, 30);
    await new Promise(r => setTimeout(r, 5000));

    // Extract unreplied reviews
    const extractCmd = '"Look at this Google Business page. Find ALL reviews that do NOT have an owner reply yet. For each unreplied review extract: author name, star rating (1-5), and the review text. Return ONLY a valid JSON array like [{\"author\":\"Name\",\"stars\":5,\"text\":\"review text\"}]. If all reviews have replies return []. If you cannot find reviews return []."';
    const rawReviews = browserCmd(extractCmd, profile, 90);

    // Parse reviews
    let reviews = [];
    try {
      const jsonMatch = rawReviews.match(/\[[\s\S]*\]/);
      if (jsonMatch) reviews = JSON.parse(jsonMatch[0]);
    } catch (e) {
      console.log(`[${profile}] Failed to parse reviews: ${e.message}`);
    }

    if (reviews.length === 0) {
      browserClose(profile);
      return res.json({
        success: true,
        profile,
        message: 'No unreplied reviews found',
        reviewsProcessed: 0,
        results: [],
      });
    }

    console.log(`[${profile}] Found ${reviews.length} unreplied reviews`);

    // Process each review
    const results = [];
    for (const review of reviews) {
      try {
        const aiReply = await generateReply(review, businessName, businessType || 'negocio', tone || 'profesional');
        if (!aiReply) continue;

        const replyCmd = `"Find the review by '${review.author}' and click Reply. Type this exact text as the reply: ${aiReply.replace(/"/g, '\\"')}. Then click Submit/Send."`;
        const result = browserCmd(replyCmd, profile, 120);

        results.push({
          author: review.author,
          stars: review.stars,
          reviewText: review.text,
          reply: aiReply,
          status: 'sent',
        });

        // Brief pause between replies
        await new Promise(r => setTimeout(r, 3000));
      } catch (e) {
        results.push({
          author: review.author,
          status: 'error',
          error: e.message,
        });
      }
    }

    browserClose(profile);

    res.json({
      success: true,
      profile,
      businessName,
      reviewsProcessed: results.length,
      results,
    });
  } catch (err) {
    browserClose(profile);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`agent-browser-api running on port ${PORT}`);
  console.log(`Display: ${process.env.DISPLAY}`);
  console.log(`Profiles dir: ${PROFILES_DIR}`);
});
