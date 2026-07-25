const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const CACHE_DIR = path.join(__dirname, '../audio-cache');
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

// Fixed spoken versions of answers for caching
const SPOKEN_ANSWERS = {
  "kb001": "We are open Monday to Friday, from 9 AM to 6 PM UK time.",
  "kb002": "You can track your order using the link we sent to your email after checkout.",
  "kb003": "You can return any unused item in its original packaging within 30 days for a full refund.",
  "kb004": "Standard delivery takes three to five business days, while express takes one to two.",
  "kb005": "Right now, we only deliver within the UK. We don't offer international shipping.",
  "kb006": "You can cancel within one hour of placing the order by contacting us. After that, it might already be processing.",
  "kb007": "We accept all major credit and debit cards, as well as PayPal.",
  "kb008": "Just click 'Forgot Password' on the login page and follow the email instructions.",
  "kb009": "Our company name is Arbil.",
  "kb010": "We provide custom solutions like business automated systems, workflow automations, and AI billing.",
  "kb011": "Yes, we can fully automate customer service using an AI agent trained on your FAQs and past interactions.",
  "kb012": "Pricing depends on your needs, but usually includes model hosting and a monthly API cost.",
  "kb013": "Yes, we can build custom solutions for inventory reconciliation and integrate them with ERPs like Sage 200.",
  "kb014": "Airbil is headquartered in Chennai, India.",
  "kb015": "We were founded in 2020. We have over five years of experience across more than two hundred fifty projects.",
  "kb016": "We serve clients in healthcare, finance, retail, and more across India, the UK, the US, and the UAE.",
  "kb017": "AI Automation means eliminating manual work with intelligent pipelines to streamline your operations.",
  "kb018": "We build modern, scalable web applications designed specifically for your business needs.",
  "kb019": "Multi-Agent AI is a service where we coordinate several AI agents to work together and solve complex problems.",
  "kb020": "Voice AI Agents are conversational AI systems that handle real business calls just like a human.",
  "kb021": "Our Digital Transformation service modernizes your infrastructure to keep your business ahead of the curve.",
  "kb022": "We are an AI-native agency on a mission to help businesses automate, build intelligent platforms, and scale.",
  "kb023": "You can reach us by phone at +91 99520 23960, or email us at hello@airbil.co.",
  "kb024": "Airbil has a dedicated team of fifteen employees.",
  "kb025": "Our process has five steps: Discovery, Strategy, Building with leading APIs, Deployment, and Optimization.",
  "kb026": "We build using LangChain, n8n, leading LLM APIs, and modern platforms like React and Next.js."
};

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function pregenerate() {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    console.error('ELEVENLABS_API_KEY is not configured in .env');
    process.exit(1);
  }

  const voiceId = 'pFZP5JQG7iQjIQuC4Bku'; // Lily (same as server.js)
  const entries = Object.entries(SPOKEN_ANSWERS);
  
  console.log(`Generating canonical audio for ${entries.length} KB entries...`);
  
  for (let i = 0; i < entries.length; i++) {
    const [id, text] = entries[i];
    const cachePath = path.join(CACHE_DIR, `${id}.mp3`);
    
    if (fs.existsSync(cachePath)) {
      console.log(`[${i+1}/${entries.length}] Cache HIT for ${id} -> Skipping`);
      continue;
    }
    
    console.log(`[${i+1}/${entries.length}] Cache MISS for ${id}: "${text.substring(0, 30)}..." -> Generating...`);
    
    try {
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
        throw new Error(`API error: ${response.status} ${errorText}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      fs.writeFileSync(cachePath, buffer);
      
      console.log(`  -> Saved ${buffer.length} bytes to ${id}.mp3`);
      
      // Wait a moment to avoid rate limits
      await sleep(500);
      
    } catch (err) {
      console.error(`  -> Failed to generate audio:`, err.message);
    }
  }
  
  console.log('\nPre-generation complete! ID-based caching is ready.');
}

pregenerate();
