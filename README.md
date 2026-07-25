# AI Customer Service Agent — Step 1 Prototype

This is a **text-only** prototype of the "brain" of the AI calling agent:
it answers customer questions from a knowledge base (RAG) and decides
when to escalate to a human. No voice/telephony yet — that gets added
in later steps once this logic is solid.

## Setup

1. Install dependencies:
   ```
   npm install
   ```

2. Get an API key from https://console.anthropic.com/ (free to sign up,
   pay-as-you-go — a few dollars of credit covers thousands of test
   messages on Haiku).

3. Copy `.env.example` to `.env` and paste your key in:
   ```
   cp .env.example .env
   ```

4. Run it:
   ```
   npm start
   ```

5. Type customer questions at the `Customer:` prompt. Try:
   - "What are your business hours?" → should answer directly from the KB
   - "Can I get a refund on a damaged item that arrived 2 months ago?" →
     should escalate, since it's outside the plain 30-day policy in the KB
   - "Can I speak to a manager about a complaint?" → should escalate

   Type `exit` to quit.

## How it works

- `knowledgeBase.json` — placeholder FAQ data. Replace this with real
  Q&A pairs extracted from the client's call recordings/emails once you
  have them (same format: `question` + `answer`).
- `index.js` — sends the whole KB + conversation so far to Claude, and
  asks it to reply in strict JSON with `response`, `escalate`, and
  `reason` fields. The escalate flag is what would trigger a transfer
  to a human rep in the real system.

## Next steps (not built yet)

- **Real KB**: swap the placeholder JSON for data extracted from actual
  call recordings + emails
- **Retrieval at scale**: once the KB grows past ~50-100 entries, switch
  from "stuff everything in the prompt" to embedding-based retrieval
  (e.g. a small vector store) so you're not sending the whole KB every
  time
- **Voice**: add speech-to-text in, this same logic in the middle,
  text-to-speech out
- **Telephony**: connect to a real phone number (Twilio) as the last step
