require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const http = require('http');
const WebSocket = require('ws');
const { createClient } = require('@deepgram/sdk');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
ffmpeg.setFfmpegPath(ffmpegPath);

const { getAgentResponse } = require('./agent');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;

const CACHE_DIR = path.join(__dirname, 'audio-cache');
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

// Deepgram Client
const deepgram = createClient(process.env.DEEPGRAM_API_KEY);

app.use(express.json());
app.use(express.urlencoded({ extended: true })); // For Twilio POSTs
app.use(express.static(path.join(__dirname, 'public')));

// Helper to generate or fetch cached speech (returns MP3 Buffer)
async function generateSpeechBuffer(text, sourceId) {
  let cacheKey = sourceId || crypto.createHash('md5').update(text).digest('hex');
  const cachePath = path.join(CACHE_DIR, `${cacheKey}.mp3`);

  if (fs.existsSync(cachePath)) {
    console.log(`[TTS Cache HIT] ${cacheKey}.mp3`);
    return fs.readFileSync(cachePath);
  }

  console.log(`[TTS Cache MISS] Generating ElevenLabs API for: ${cacheKey}`);
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error('ELEVENLABS_API_KEY is not configured');

  const voiceId = 'pFZP5JQG7iQjIQuC4Bku'; // Lily
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
      voice_settings: { stability: 0.5, similarity_boost: 0.5 }
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`ElevenLabs API error: ${response.status} ${errorText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  fs.writeFileSync(cachePath, buffer);
  return buffer;
}

// Convert MP3 Buffer to 8kHz mulaw Buffer via ffmpeg in-memory
async function convertMp3ToMulaw(mp3Buffer) {
  return new Promise((resolve, reject) => {
    const { PassThrough } = require('stream');
    const inputStream = new PassThrough();
    inputStream.end(mp3Buffer);

    const buffers = [];
    const outputStream = new PassThrough();
    outputStream.on('data', (chunk) => buffers.push(chunk));
    outputStream.on('end', () => resolve(Buffer.concat(buffers)));

    ffmpeg(inputStream)
      .inputFormat('mp3')
      .audioFrequency(8000)
      .audioCodec('pcm_mulaw')
      .format('mulaw')
      .on('error', (err) => reject(err))
      .pipe(outputStream);
  });
}

// ==========================================
// BROWSER DEMO ENDPOINTS
// ==========================================
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

app.post('/api/speak', async (req, res) => {
  try {
    const { text, sourceId } = req.body;
    if (!text) return res.status(400).json({ error: 'Text is required' });
    
    const buffer = await generateSpeechBuffer(text, sourceId);
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

// ==========================================
// TWILIO ENDPOINTS
// ==========================================
app.post('/twilio/voice', (req, res) => {
  // Use wss:// if ngrok is https, otherwise ws:// for localhost
  const host = req.headers.host;
  const protocol = host.includes('localhost') ? 'ws' : 'wss';
  
  res.set('Content-Type', 'text/xml');
  res.send(`
    <Response>
      <Connect>
        <Stream url="${protocol}://${host}/twilio/stream" />
      </Connect>
    </Response>
  `);
});

wss.on('connection', (ws, req) => {
  if (req.url !== '/twilio/stream') {
    return ws.close();
  }
  
  console.log('[Twilio] Call connected');

  let streamSid = null;
  let isProcessing = false;
  let conversationHistory = []; // Track history for this call
  
  // Setup Deepgram Live
  const dgConnection = deepgram.listen.live({
    model: "nova-2",
    encoding: "mulaw",
    sample_rate: 8000,
    channels: 1,
    smart_format: true
  });

  dgConnection.on('open', () => {
    console.log('[Deepgram] Connection opened');
  });

  dgConnection.on('Results', async (data) => {
    if (isProcessing) return; // Prevent talking over ourselves

    const transcript = data.channel.alternatives[0].transcript;
    if (data.is_final && transcript.trim() !== '') {
      console.log(`[Caller]: ${transcript}`);
      
      isProcessing = true;
      conversationHistory.push({ role: 'user', content: transcript });
      
      try {
        const agentResult = await getAgentResponse(conversationHistory);
        console.log(`[Agent]: ${agentResult.response}`);
        
        conversationHistory.push({ 
            role: 'assistant', 
            content: JSON.stringify(agentResult)
        });

        // Generate Audio
        const mp3Buffer = await generateSpeechBuffer(agentResult.response, agentResult.sourceId);
        
        // Convert to Twilio's format
        const mulawBuffer = await convertMp3ToMulaw(mp3Buffer);
        
        // Send back to Twilio
        ws.send(JSON.stringify({
          event: "media",
          streamSid: streamSid,
          media: {
            payload: mulawBuffer.toString('base64')
          }
        }));

        // Send Mark to know when the agent finishes speaking
        const markName = agentResult.escalate ? 'escalate_end' : 'speech_end';
        ws.send(JSON.stringify({
          event: "mark",
          streamSid: streamSid,
          mark: { name: markName }
        }));
        
      } catch (err) {
        console.error('[Agent/Audio Error]', err);
        isProcessing = false;
      }
    }
  });

  dgConnection.on('error', (err) => {
    console.error('[Deepgram Error]', err);
  });

  // Handle incoming Twilio messages
  ws.on('message', (message) => {
    const msg = JSON.parse(message);
    
    if (msg.event === 'start') {
      streamSid = msg.start.streamSid;
      console.log(`[Twilio] Stream started: ${streamSid}`);
    } else if (msg.event === 'media') {
      // Send audio directly to Deepgram
      if (dgConnection && dgConnection.getReadyState() === 1) {
        dgConnection.send(Buffer.from(msg.media.payload, 'base64'));
      }
    } else if (msg.event === 'mark') {
      console.log(`[Twilio] Mark received: ${msg.mark.name}`);
      if (msg.mark.name === 'escalate_end') {
        console.log(`[Twilio] Escalate flag was true, hanging up call.`);
        ws.close();
      } else {
        isProcessing = false; // Agent finished speaking, resume listening
      }
    } else if (msg.event === 'stop') {
      console.log(`[Twilio] Stream stopped`);
    }
  });

  ws.on('close', () => {
    console.log('[Twilio] Call disconnected');
    if (dgConnection) dgConnection.finish();
  });
});

server.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`);
});
