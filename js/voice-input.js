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
    const parsedItems = data.items || [];

    if (!parsedItems.length) {
      voiceStatus.textContent = 'No ingredients matched. Try speaking more clearly.';
      voiceStatus.style.color = 'var(--color-high)';
      return;
    }

    voiceStatus.textContent = 'Matching ingredients...';
    const results = await matchVoiceItems(parsedItems);
    _pendingVoiceMatches = results;
    voiceStatus.textContent = '';
    renderVoiceConfirmation(results);

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

function renderVoiceConfirmation(matchResults) {
  const container = document.getElementById('voice-confirmation');
  if (!container) return;

  const disambig = matchResults.filter(r => r.needs_disambiguation);
  const askUser = matchResults.filter(r => r.ask_user);
  const unmatched = matchResults.filter(r => r.match_type === 'unmatched');

  const matched = matchResults.filter(r => r.ingredient && !r.needs_disambiguation);
  const total = matched.length + disambig.length;
  if (total === 0 && askUser.length === 0) {
    document.getElementById('voice-status').textContent =
      'No ingredients recognised. Try speaking more clearly or search manually.';
    return;
  }

  container.innerHTML = `
    <div class='voice-confirm-card'>
      <div class='voice-confirm-heading'>
        I heard ${matchResults.length} item${matchResults.length > 1 ? 's' : ''}
        — confirm before adding:
      </div>

      <div class='voice-confirm-items' id='voice-confirm-list'>
        ${matchResults.map((r, i) => renderConfirmRow(r, i)).join('')}
      </div>

      ${unmatched.length ? `
        <p class='voice-confirm-unmatched'>
          Could not match: ${unmatched.map(r => r.spoken).join(', ')}.
          Add these manually from the search tab.
        </p>` : ''}

      <div class='voice-confirm-actions'>
        <button onclick='confirmVoiceItems()'
                class='btn-confirm-voice'>
          Add all to meal
        </button>
        <button onclick='cancelVoiceConfirmation()'
                class='btn-cancel-voice'>
          Cancel
        </button>
      </div>
    </div>`;

  container.style.display = 'block';
  _pendingVoiceMatches = matchResults;
}

function renderConfirmRow(result, index) {
  const isAsk = result.ask_user;
  const isDisambig = result.needs_disambiguation;
  const ingName = result.ingredient?.name || '??';

  if (isAsk) {
    return `
      <div class='confirm-row confirm-ask' data-index='${index}'>
        <span class='confirm-spoken'>"${result.spoken}"</span>
        <span class='confirm-arrow'>→</span>
        <input type='text' class='confirm-search-input'
               placeholder='Which ingredient?'
               oninput='searchConfirmIngredient(${index}, this.value)'
               id='confirm-search-${index}' />
        <div class='confirm-search-results' id='confirm-results-${index}'></div>
      </div>`;
  }

  return `
    <div class='confirm-row ${isDisambig ? 'confirm-disambig' : 'confirm-matched'}'
         data-index='${index}'>
      <span class='confirm-ingredient-name'>${ingName}</span>
      <span class='confirm-heard'>heard: "${result.spoken}"</span>
      <div class='confirm-grams'>
        <button onclick='adjustConfirmGrams(${index}, -25)'>−</button>
        <span class='confirm-gram-value' id='confirm-g-${index}'>
          ${result.grams}
        </span>
        <span>g</span>
        <button onclick='adjustConfirmGrams(${index}, 25)'>+</button>
      </div>
      ${isDisambig ? `
        <select class='confirm-disambig-select'
                onchange='setConfirmIngredient(${index}, this.value)'>
          ${result.options.map(opt => `
            <option value='${opt.id}'
              ${opt.id === result.ingredient?.id ? 'selected' : ''}>
              ${opt.name}
            </option>`).join('')}
        </select>` : ''}
    </div>`;
}

function adjustConfirmGrams(index, delta) {
  const result = _pendingVoiceMatches[index];
  result.grams = Math.max(10, (result.grams || 100) + delta);
  document.getElementById(`confirm-g-${index}`).textContent = result.grams;
}

function setConfirmIngredient(index, ingredientId) {
  const result = _pendingVoiceMatches[index];
  result.ingredient = getIngredientById(ingredientId);
  result.needs_disambiguation = false;
}

function searchConfirmIngredient(index, query) {
  if (query.length < 2) {
    document.getElementById(`confirm-results-${index}`).innerHTML = '';
    return;
  }
  const results = searchIngredients(query).slice(0, 5);
  document.getElementById(`confirm-results-${index}`).innerHTML =
    results.map(ing => `
      <div class='confirm-search-result'
           onclick='selectConfirmIngredient(${index}, "${ing.id}",
                    "${ing.name.replace(/'/g, "\\'")}")'>
        ${ing.name}
      </div>`).join('');
}

function selectConfirmIngredient(index, id, name) {
  _pendingVoiceMatches[index].ingredient = getIngredientById(id);
  _pendingVoiceMatches[index].ask_user = false;
  document.getElementById(`confirm-search-${index}`).value = name;
  document.getElementById(`confirm-results-${index}`).innerHTML = '';
}

function confirmVoiceItems() {
  const results = _pendingVoiceMatches || [];
  let added = 0;
  for (const r of results) {
    if (!r.ingredient) continue;
    state.mealItems.push({
      type: 'ingredient',
      id: r.ingredient.id,
      gramAmount: r.grams || 100,
      cooking_method: r.cooking_method || null,
    });
    added++;
  }
  cancelVoiceConfirmation();
  renderMealItems();
  updateNutrientTotals();
  updateCalculateButton();
  document.getElementById('voice-status').textContent =
    `Added ${added} ingredient${added !== 1 ? 's' : ''} to meal.`;
  document.getElementById('voice-status').style.color = 'var(--color-low)';
}

function cancelVoiceConfirmation() {
  const container = document.getElementById('voice-confirmation');
  if (container) { container.innerHTML = ''; container.style.display = 'none'; }
  _pendingVoiceMatches = [];
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
