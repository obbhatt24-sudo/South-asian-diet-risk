let _recognition = null;
let _isListening = false;
let _pendingVoiceMatches = [];  // consumed by the Step 85 confirmation UI

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

  if (!parsedItems.length) {
    voiceStatus.textContent = 'No ingredients matched. Try speaking more clearly.';
    voiceStatus.style.color = 'var(--color-high)';
    return;
  }

  voiceStatus.textContent = 'Matching ingredients...';
  const results = await matchVoiceItems(parsedItems);
  _pendingVoiceMatches = results;

  // Nothing is added to state.mealItems here — items that matched cleanly,
  // need disambiguation, or need the user to specify are all handed to the
  // Step 85 confirmation UI, which is responsible for adding confirmed
  // items to the meal.
  const resolved = results.filter(r =>
    r.ingredient && !r.needs_disambiguation && !r.ask_user);
  const needsInput = results.filter(r =>
    r.needs_disambiguation || r.ask_user || !r.ingredient);

  let msg = `Matched ${resolved.length} ingredient${resolved.length !== 1 ? 's' : ''}.`;
  if (needsInput.length > 0) {
    msg += ` ${needsInput.length} need confirmation: ` +
      needsInput.map(r => r.spoken).join(', ') + '.';
  }
  voiceStatus.textContent = msg;
  voiceStatus.style.color = resolved.length > 0 ? 'var(--color-low)' : 'var(--color-high)';
}

async function startCookingMethodVoice() {
  if (!isVoiceSupported()) {
    alert('Voice input is not supported in this browser.');
    return;
  }

  const lang = getCurrentLang();
  const btn = document.getElementById('cooking-voice-btn');
  const status = document.getElementById('cooking-voice-status');

  const recognition = initVoiceRecognition();
  recognition.lang = VOICE_LANG_MAP[lang] || 'en-IN';

  btn.classList.add('listening');
  btn.textContent = '⏹ Stop';
  status.textContent = 'Listening... describe how your food was cooked.';

  let transcript = '';

  recognition.onresult = (e) => {
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (e.results[i].isFinal) transcript += e.results[i][0].transcript;
    }
    status.textContent = transcript;
  };

  recognition.onend = async () => {
    btn.classList.remove('listening');
    btn.textContent = '🎤 Describe how it was cooked';
    if (!transcript.trim()) return;
    await parseCookingMethodsFromTranscript(transcript);
  };

  recognition.start();
}

async function parseCookingMethodsFromTranscript(transcript) {
  const status = document.getElementById('cooking-voice-status');
  status.textContent = 'Applying cooking methods...';

  // Index into state.mealItems is preserved so assignments map back exactly.
  const currentItems = state.mealItems
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.type === 'ingredient')
    .map(({ item, index }) => ({
      index,
      name: getIngredientById(item.id)?.name || item.id
    }));

  const methodIds = (_cookingMethods || [])
    .map(m => m.id + ' (' + m.name + ')');

  // The LLM parse runs on the backend (RAG_SERVER_URL, defined in
  // explainer.js) so the Anthropic API key stays server-side — the browser
  // cannot and must not call api.anthropic.com directly.
  try {
    const response = await fetch(RAG_SERVER_URL + '/parse-cooking-methods', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transcript: transcript,
        ingredient_names: currentItems.map(i => i.name),
        method_ids: methodIds,
        language: getCurrentLang()
      }),
      signal: AbortSignal.timeout(60000)  // cover Render free-tier cold starts
    });

    if (!response.ok) throw new Error('Server error: ' + response.status);
    const data = await response.json();
    const assignments = data.assignments || [];

    let applied = 0;
    for (const assignment of assignments) {
      if (!assignment.ingredient_name || !assignment.method_id) continue;
      const match = currentItems.find(item =>
        item.name.toLowerCase().includes(
          assignment.ingredient_name.toLowerCase())
      );
      if (match) {
        state.mealItems[match.index].cooking_method = assignment.method_id;
        applied++;
      }
    }

    renderMealItems();
    updateNutrientTotals();
    status.textContent = `Applied cooking methods to ${applied} ingredient${applied !== 1 ? 's' : ''}.`;
    status.style.color = 'var(--color-low)';

  } catch(err) {
    if (err.name === 'TimeoutError') {
      status.textContent =
        'Cooking-method parsing timed out (server warming up). Try again.';
    } else {
      status.textContent = 'Could not parse cooking methods.';
    }
    status.style.color = 'var(--color-high)';
    console.error('Cooking-method parse error:', err);
  }
}
