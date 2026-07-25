const micBtn = document.getElementById('mic-btn');
const statusText = document.getElementById('status-text');
const chatLog = document.getElementById('chat-log');
const escalationBanner = document.getElementById('escalation-banner');

let conversationHistory = [];
let recognition;
let isCallActive = false;
let isListening = false;
let isProcessing = false;
let currentAudio = null;

// Initialize Web Speech API for STT
if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new SpeechRecognition();
    recognition.continuous = false; // False allows it to pause automatically when user stops speaking
    recognition.interimResults = false;
    recognition.lang = 'en-US';

    recognition.onstart = () => {
        isListening = true;
        micBtn.classList.add('recording');
        statusText.textContent = 'Listening...';
        // Stop any ongoing speech when user starts talking
        window.speechSynthesis.cancel();
    };

    recognition.onresult = async (event) => {
        const transcript = event.results[0][0].transcript;
        if (transcript.trim()) {
            isProcessing = true;
            statusText.textContent = 'Processing...';
            micBtn.classList.remove('recording');
            await handleUserMessage(transcript);
        }
    };

    recognition.onerror = (event) => {
        console.error('Speech recognition error', event.error);
        if (event.error !== 'no-speech') {
            statusText.textContent = 'Error: ' + event.error;
            isCallActive = false;
            micBtn.classList.remove('recording');
        }
    };

    recognition.onend = () => {
        isListening = false;
        micBtn.classList.remove('recording');
        
        // Auto-resume listening if call is active and we are not processing a response
        if (isCallActive && !isProcessing) {
            try { 
                recognition.start(); 
            } catch(e) {
                console.error('Failed to restart recognition', e);
            }
        } else if (!isCallActive) {
            statusText.textContent = 'Ready';
        }
    };
} else {
    statusText.textContent = 'Web Speech API not supported in this browser.';
    micBtn.disabled = true;
}

// UI Helpers
function appendMessage(text, sender) {
    const msgDiv = document.createElement('div');
    msgDiv.classList.add('message', sender);
    msgDiv.textContent = text;
    chatLog.appendChild(msgDiv);
    chatLog.scrollTop = chatLog.scrollHeight;
}

// Speak text using ElevenLabs API with Web Speech fallback
async function speak(text) {
    if (currentAudio) {
        currentAudio.pause();
        currentAudio = null;
    }
    window.speechSynthesis.cancel();

    const onSpeechEnd = () => {
        // Once finished speaking, resume listening if the call is still active
        if (isCallActive) {
            isProcessing = false; // Done processing
            try { 
                if (!isListening) recognition.start(); 
            } catch(e) {}
        } else {
            statusText.textContent = 'Ready';
        }
    };

    try {
        const response = await fetch('/api/speak', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text })
        });
        
        if (!response.ok) throw new Error('ElevenLabs API failed');
        
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        currentAudio = new Audio(url);
        
        currentAudio.onended = () => {
            URL.revokeObjectURL(url);
            onSpeechEnd();
        };
        
        await currentAudio.play();
    } catch (err) {
        console.warn('ElevenLabs TTS failed, falling back to window.speechSynthesis:', err);
        if ('speechSynthesis' in window) {
            const utterance = new SpeechSynthesisUtterance(text);
            const voices = window.speechSynthesis.getVoices();
            const preferredVoice = voices.find(v => v.lang === 'en-US' && v.name.includes('Female')) || voices[0];
            if (preferredVoice) utterance.voice = preferredVoice;
            utterance.onend = onSpeechEnd;
            window.speechSynthesis.speak(utterance);
        } else {
            onSpeechEnd();
        }
    }
}

// Handle sending message to backend
async function handleUserMessage(text) {
    appendMessage(text, 'user');
    conversationHistory.push({ role: 'user', content: text });
    
    try {
        const response = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ conversationHistory })
        });
        
        const data = await response.json();
        
        if (data.error) {
            console.error('Server error:', data.error);
            statusText.textContent = 'Error processing request.';
            isProcessing = false;
            return;
        }

        // Add assistant response to history
        conversationHistory.push({
            role: 'assistant',
            content: JSON.stringify(data)
        });

        appendMessage(data.response, 'agent');
        speak(data.response);

        if (data.escalate) {
            escalationBanner.classList.remove('hidden');
            console.warn('Escalation triggered:', data.reason);
        } else {
            escalationBanner.classList.add('hidden');
        }
    } catch (err) {
        console.error('Fetch error:', err);
        statusText.textContent = 'Network error.';
        isProcessing = false;
    }
}

// Call Toggle Logic
function toggleCall() {
    if (!recognition) return;
    
    if (isCallActive) {
        // End Call
        isCallActive = false;
        isProcessing = false;
        recognition.stop();
        window.speechSynthesis.cancel();
        if (currentAudio) {
            currentAudio.pause();
            currentAudio = null;
        }
        statusText.textContent = 'Call Ended. Tap to start.';
        micBtn.classList.remove('recording');
    } else {
        // Start Call
        isCallActive = true;
        isProcessing = false;
        try { 
            recognition.start(); 
        } catch(e) {}
    }
}

// Click event to toggle call state
micBtn.addEventListener('click', toggleCall);

// Load voices proactively
if ('speechSynthesis' in window) {
    window.speechSynthesis.onvoiceschanged = () => {
        window.speechSynthesis.getVoices();
    };
}
