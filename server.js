const express = require('express');
const { execSync, exec } = require('child_process');
const { OpenAI } = require('openai');
const fs = require('fs');
const path = require('path');
const http = require('http');
const net = require('net');
const WebSocket = require('ws');

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

// Close browser for a specific profile
function browserClose(profileName) {
  try {
    const profile = profileName.replace(/[^a-zA-Z0-9_-]/g, '');
    const profileDir = path.join(PROFILES_DIR, profile);
    // Kill only chromium processes using this profile's data dir
    execSync(`pkill -f "user-data-dir=${profileDir}" || true`, { timeout: 10000, encoding: 'utf-8', shell: true });
  } catch (e) { /* ignore */ }
}

// Close ALL browser processes (for cleanup)
function browserCloseAll() {
  try {
    execSync('pkill -f chromium || true', { timeout: 10000, encoding: 'utf-8', shell: true });
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

// Health check (public: minimal info, authed: full details)
app.get('/health', (req, res) => {
  const key = req.headers['x-api-key'] || req.query.apiKey;
  const isAuthed = key === API_KEY;
  let abVersion = 'unknown';
  try {
    abVersion = execSync('agent-browser --version', { encoding: 'utf-8', timeout: 5000 }).trim();
  } catch (e) { abVersion = 'not found'; }

  let chromeOk = false;
  let chromeVersion = 'not found';
  try {
    chromeVersion = execSync('chromium --version || chrome --version', { encoding: 'utf-8', timeout: 5000, shell: true }).trim();
    chromeOk = true;
  } catch (e) { /* */ }

  const response = { status: 'ok' };
  if (isAuthed) {
    response.agentBrowser = abVersion;
    response.chrome = chromeOk;
    response.chromeVersion = chromeVersion;
    response.display = process.env.DISPLAY || 'not set';
    try {
      response.profiles = fs.readdirSync(PROFILES_DIR).filter(f =>
        fs.statSync(path.join(PROFILES_DIR, f)).isDirectory()
      );
    } catch (e) { response.profiles = []; }
  }
  res.json(response);
});

// Open headed Chrome for Google login (use via VNC)
app.post('/setup', auth, async (req, res) => {
  const { profileName } = req.body;
  if (!profileName) return res.status(400).json({ error: 'profileName required' });

  const profile = profileName.replace(/[^a-zA-Z0-9_-]/g, '');
  const profileDir = path.join(PROFILES_DIR, profile);
  if (!fs.existsSync(profileDir)) fs.mkdirSync(profileDir, { recursive: true });

  try {
    browserClose(profile);
    // Launch Chromium directly (stays open for user interaction via VNC)
    const chromeBin = process.env.CHROME_BIN || 'chromium';
    const cmd = `${chromeBin} --user-data-dir=${profileDir} --display=:99 ${BROWSER_ARGS} --user-agent="${USER_AGENT}" --no-sandbox https://accounts.google.com`;
    exec(cmd, { timeout: 600000, env: { ...process.env, DISPLAY: ':99' } }); // 10 min timeout
    res.json({
      success: true,
      message: `Chrome opened for profile "${profile}". Use VNC to log in to Google. Browser stays open for 10 minutes.`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Close browser after setup
app.post('/setup-done', auth, async (req, res) => {
  const { profileName } = req.body;
  if (!profileName) return res.status(400).json({ error: 'profileName required' });
  browserClose(profileName.replace(/[^a-zA-Z0-9_-]/g, ''));
  res.json({ success: true, message: 'Browser closed, session saved.' });
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

// Serve noVNC client page
app.get('/vnc', auth, (req, res) => {
  const wsProtocol = req.headers['x-forwarded-proto'] === 'https' ? 'wss' : 'ws';
  const host = req.headers.host;
  res.send(`<!DOCTYPE html>
<html><head><title>Agent Browser VNC</title>
<style>body{margin:0;background:#1a1a2e;display:flex;flex-direction:column;height:100vh}
#status{color:#0f0;font-family:monospace;padding:8px;background:#111}
#screen{flex:1;overflow:hidden}</style>
</head><body>
<div id="status">Loading noVNC...</div>
<div id="screen"></div>
<script type="module">
import RFB from 'https://cdn.jsdelivr.net/gh/novnc/noVNC@v1.5.0/core/rfb.js';
const wsUrl = '${wsProtocol}://${host}/websockify?apiKey=${req.query.apiKey || ''}';
document.getElementById('status').textContent = 'Connecting...';
try {
  const rfb = new RFB(document.getElementById('screen'), wsUrl);
  rfb.scaleViewport = true;
  rfb.resizeSession = true;
  rfb.addEventListener('connect', () => {
    document.getElementById('status').textContent = 'Connected - Log in to Google below';
  });
  rfb.addEventListener('disconnect', (e) => {
    document.getElementById('status').textContent = 'Disconnected';
  });
} catch(e) {
  document.getElementById('status').textContent = 'Error: ' + e.message;
}
</script>
</body></html>`);
});

// noVNC served from jsDelivr CDN (no local files needed)

// Create HTTP server (needed for WebSocket upgrade)
const server = http.createServer(app);

// WebSocket proxy: /websockify -> VNC on localhost:5900
const wss = new WebSocket.Server({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  if (req.url.startsWith('/websockify')) {
    // Check API key
    const url = new URL(req.url, 'http://localhost');
    const apiKey = url.searchParams.get('apiKey');
    if (apiKey !== API_KEY) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      // Connect to VNC server
      const vnc = net.connect(5900, 'localhost', () => {
        console.log('VNC proxy connected');
      });

      vnc.on('data', (data) => {
        try { ws.send(data); } catch(e) {}
      });

      ws.on('message', (data) => {
        try { vnc.write(data); } catch(e) {}
      });

      ws.on('close', () => vnc.end());
      vnc.on('close', () => ws.close());
      vnc.on('error', (e) => { console.error('VNC error:', e.message); ws.close(); });
      ws.on('error', (e) => { console.error('WS error:', e.message); vnc.end(); });
    });
  }
});

server.listen(PORT, () => {
  console.log(`agent-browser-api running on port ${PORT}`);
  console.log(`Display: ${process.env.DISPLAY}`);
  console.log(`Profiles dir: ${PROFILES_DIR}`);
  console.log(`VNC: /vnc?apiKey=<key> | WebSocket proxy: /websockify?apiKey=<key>`);
});
