let _recognition = null;
let _isListening = false;

const VOICE_LANG_MAP = {
  en: 'en-IN',  // English with Indian accent model
  hi: 'hi-IN',
  gu: 'gu-IN',
  ta: 'ta-IN',
  te: 'te-IN',
};

function isVoiceSupported() {
  return 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window;
}

function initVoiceRecognition() {
  if (!isVoiceSupported()) return null;
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const recognition = new SR();
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;
  return recognition;
}

async function startVoiceLogging() {
  if (!isVoiceSupported()) {
    alert('Voice input is not supported in this browser. ' +
          'Please use Chrome or Edge.');
    return;
  }

  const lang = getCurrentLang();
  const micBtn = document.getElementById('mic-btn');
  const voiceStatus = document.getElementById('voice-status');

  if (_isListening) {
    _recognition?.stop();
    return;
  }

  _recognition = initVoiceRecognition();
  _recognition.lang = VOICE_LANG_MAP[lang] || 'en-IN';

  _isListening = true;
  micBtn.classList.add('listening');
  micBtn.textContent = '⏹ Stop';
  voiceStatus.textContent = 'Listening... speak your meal now.';
  voiceStatus.style.color = 'var(--color-teal)';

  let finalTranscript = '';

  _recognition.onresult = (event) => {
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      if (event.results[i].isFinal) {
        finalTranscript += event.results[i][0].transcript;
      } else {
        interim += event.results[i][0].transcript;
      }
    }
    voiceStatus.textContent = finalTranscript + interim;
  };

  _recognition.onerror = (event) => {
    voiceStatus.textContent = 'Error: ' + event.error;
    voiceStatus.style.color = 'var(--color-high)';
    _isListening = false;
    micBtn.classList.remove('listening');
    micBtn.textContent = '🎤 Speak meal';
  };

  _recognition.onend = async () => {
    _isListening = false;
    micBtn.classList.remove('listening');
    micBtn.textContent = '🎤 Speak meal';

    if (!finalTranscript.trim()) {
      voiceStatus.textContent = 'No speech detected. Try again.';
      return;
    }

    voiceStatus.textContent = 'Parsing meal from: "' + finalTranscript + '"';
    await parseMealFromTranscript(finalTranscript, lang);
  };

  _recognition.start();
}

async function parseMealFromTranscript(transcript, lang) {
  const voiceStatus = document.getElementById('voice-status');
  voiceStatus.textContent = 'Identifying ingredients...';

  // Local ingredient DB names, sent so the model matches to entries we have.
  const ingredientNames = _ingredients
    .slice(0, 100)
    .map(i => i.name);

  // The LLM parse runs on the backend (RAG_SERVER_URL, defined in
  // explainer.js) so the Anthropic API key stays server-side — the browser
  // cannot and must not call api.anthropic.com directly.
  try {
    const response = await fetch(RAG_SERVER_URL + '/parse-meal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transcript: transcript,
        ingredient_names: ingredientNames,
        language: lang
      }),
      signal: AbortSignal.timeout(60000)  // cover Render free-tier cold starts
    });

    if (!response.ok) throw new Error('Server error: ' + response.status);
    const data = await response.json();

    await applyVoiceMealItems(data.items || []);

  } catch(err) {
    if (err.name === 'TimeoutError') {
      voiceStatus.textContent =
        'Meal parsing timed out (server warming up). Try again.';
    } else {
      voiceStatus.textContent = 'Could not parse meal. Try typing instead.';
    }
    voiceStatus.style.color = 'var(--color-high)';
    console.error('Voice parse error:', err);
  }
}

async function applyVoiceMealItems(parsedItems) {
  const voiceStatus = document.getElementById('voice-status');
  const matched = [];
  const unmatched = [];

  for (const item of parsedItems) {
    // Try to match to existing ingredient
    const ing = _ingredients.find(i =>
      i.name.toLowerCase() === item.name.toLowerCase() ||
      i.name.toLowerCase().includes(item.name.toLowerCase())
    );

    if (ing) {
      matched.push({
        type: 'ingredient',
        id: ing.id,
        gramAmount: item.grams || 100,
        cooking_method: item.cooking_method || null
      });
    } else {
      unmatched.push(item.name);
    }
  }

  if (matched.length > 0) {
    state.mealItems = [...state.mealItems, ...matched];
    renderMealItems();
    updateNutrientTotals();
    updateCalculateButton();

    let msg = `Added ${matched.length} ingredient${matched.length > 1 ? 's' : ''}.`;
    if (unmatched.length > 0) {
      msg += ` Could not match: ${unmatched.join(', ')} — add manually.`;
    }
    voiceStatus.textContent = msg;
    voiceStatus.style.color = 'var(--color-low)';
  } else {
    voiceStatus.textContent = 'No ingredients matched. Try speaking more clearly.';
    voiceStatus.style.color = 'var(--color-high)';
  }
}
