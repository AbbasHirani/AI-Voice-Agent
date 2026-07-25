const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { getAgentResponse } = require('./agent');

const app = express();
const PORT = process.env.PORT || 3000;

const CACHE_DIR = path.join(__dirname, 'audio-cache');
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

// Middleware to parse JSON bodies
app.use(express.json());

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// API Endpoint to handle chat
app.post('/api/chat', async (req, res) => {
  try {
    const { conversationHistory } = req.body;
    
    if (!conversationHistory || !Array.isArray(conversationHistory)) {
      return res.status(400).json({ error: 'Invalid conversationHistory' });
    }

    const result = await getAgentResponse(conversationHistory);
    res.json(result);
  } catch (error) {
    console.error('Error in /api/chat:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// API Endpoint to handle TTS via ElevenLabs
app.post('/api/speak', async (req, res) => {
  try {
    const { text, sourceId } = req.body;
    if (!text) return res.status(400).json({ error: 'Text is required' });

    let cacheKey = null;
    if (sourceId) {
      cacheKey = sourceId;
    } else {
      cacheKey = crypto.createHash('md5').update(text).digest('hex');
    }

    const cachePath = path.join(CACHE_DIR, `${cacheKey}.mp3`);

    if (fs.existsSync(cachePath)) {
      console.log(`[TTS Cache HIT] Serving from cache: ${cacheKey}.mp3`);
      const buffer = fs.readFileSync(cachePath);
      res.set({
        'Content-Type': 'audio/mpeg',
        'Content-Length': buffer.length
      });
      return res.send(buffer);
    }

    console.log(`[TTS Cache MISS] Calling ElevenLabs API for key: ${cacheKey}`);
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'ELEVENLABS_API_KEY is not configured' });

    // Default Free Voice ID (Lily)
    const voiceId = 'pFZP5JQG7iQjIQuC4Bku';
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: {
        'Accept': 'audio/mpeg',
        'Content-Type': 'application/json',
        'xi-api-key': apiKey
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_flash_v2_5',
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.5
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`ElevenLabs API error: ${response.status} ${errorText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Save to cache
    fs.writeFileSync(cachePath, buffer);

    res.set({
      'Content-Type': 'audio/mpeg',
      'Content-Length': buffer.length
    });
    res.send(buffer);
  } catch (error) {
    console.error('Error in /api/speak:', error);
    res.status(500).json({ error: 'Failed to generate speech' });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`);
});
