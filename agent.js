const fs = require("fs");
const path = require("path");
require("dotenv").config();
const { GoogleGenerativeAI } = require("@google/generative-ai");

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const knowledgeBase = JSON.parse(
  fs.readFileSync(path.join(__dirname, "knowledgeBase.json"), "utf-8")
);

function buildKnowledgeBaseContext() {
  return knowledgeBase
    .map((entry) => `Q: ${entry.question}\nA: ${entry.answer}`)
    .join("\n\n");
}

const SYSTEM_PROMPT = `You are an intelligent, empathetic customer service phone agent.

Your goal is to assist the customer using ONLY the knowledge base provided below.
Do not use outside knowledge. Do not guess or make up answers. 
Be forgiving of speech-to-text errors (e.g. if the user says "last door" instead of "last hour").

KNOWLEDGE BASE:
${buildKnowledgeBaseContext()}

RULES:
- Be highly conversational and natural. Keep responses brief (1-2 sentences) since this is a voice call.
- If the customer's question is covered by the knowledge base, answer it directly.
- If a policy prevents the customer from doing what they want (e.g., cancelling after 1 hour), politely explain the policy and ask if there is anything else you can help with. DO NOT automatically escalate just because the answer is "no".
- ONLY set "escalate": true if:
  1. The user's specific question is NOT covered by the knowledge base at all.
  2. The user explicitly asks to speak to a human or manager.
  3. The user is angry, frustrated, or making a complaint.
  4. The situation involves highly sensitive information.

You must respond with ONLY a JSON object in this exact format, no other text:
{
  "response": "what to say to the customer (keep it natural and conversational)",
  "escalate": true or false,
  "reason": "brief internal note on why you did or didn't escalate"
}`;

const model = genAI.getGenerativeModel({
  model: "gemini-3.1-flash-lite",
  systemInstruction: SYSTEM_PROMPT,
  generationConfig: {
    responseMimeType: "application/json",
  }
});

async function getAgentResponse(conversationHistory) {
  try {
    if (!conversationHistory || conversationHistory.length === 0) {
      throw new Error("Empty conversation history");
    }

    const formattedHistory = conversationHistory.slice(0, -1).map(msg => ({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.content }]
    }));

    const lastUserMsg = conversationHistory[conversationHistory.length - 1].content;

    const chat = model.startChat({
      history: formattedHistory
    });

    const result = await chat.sendMessage(lastUserMsg);
    const rawText = result.response.text();
    
    return JSON.parse(rawText.trim());
  } catch (err) {
    return {
      response:
        "Sorry, let me connect you with one of our team members to help with that.",
      escalate: true,
      reason: `Failed to get model output: ${err.message}`,
    };
  }
}

module.exports = {
  getAgentResponse,
};
