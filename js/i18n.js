let _currentLang = 'en';
let _strings = {};

const SUPPORTED_LANGUAGES = {
  en: { name: 'English',  nativeName: 'English',    flag: '🇬🇧' },
  hi: { name: 'Hindi',    nativeName: 'हिन्दी',       flag: '🇮🇳' },
  gu: { name: 'Gujarati', nativeName: 'ગુજરાતી',      flag: '🇮🇳' },
  ta: { name: 'Tamil',    nativeName: 'தமிழ்',        flag: '🇮🇳' },
  te: { name: 'Telugu',   nativeName: 'తెలుగు',       flag: '🇮🇳' },
};

async function loadLanguage(lang) {
  if (!SUPPORTED_LANGUAGES[lang]) lang = 'en';
  try {
    const res = await fetch(`data/i18n/${lang}.json`);
    _strings = await res.json();
    _currentLang = lang;
    localStorage.setItem('preferred_lang', lang);
    document.documentElement.lang = lang;
    console.log('Language loaded:', lang);
    return true;
  } catch(e) {
    console.warn('Failed to load language:', lang, e.message);
    if (lang !== 'en') return loadLanguage('en');
    return false;
  }
}

function t(key, replacements = {}) {
  // Navigate nested keys: t('scores.diabetes.title')
  const keys = key.split('.');
  let val = _strings;
  for (const k of keys) {
    val = val?.[k];
    if (val === undefined) {
      console.warn('Missing i18n key:', key);
      return key;  // fallback to key name
    }
  }
  // Replace placeholders: t('scores.band_desc', { score: 72 })
  return String(val).replace(/\{(\w+)\}/g,
    (_, k) => replacements[k] ?? `{${k}}`);
}

function getCurrentLang() { return _currentLang; }

async function initI18n() {
  const saved = localStorage.getItem('preferred_lang') || 'en';
  await loadLanguage(saved);
  renderLanguageSwitcher();
}

function renderLanguageSwitcher() {
  const switcher = document.getElementById('lang-switcher');
  if (!switcher) return;
  switcher.innerHTML = Object.entries(SUPPORTED_LANGUAGES).map(([code, lang]) => `
    <button class='lang-btn ${code === _currentLang ? "active" : ""}'
            onclick='switchLanguage("${code}")'
            title='${lang.name}'>
      ${lang.nativeName}
    </button>
  `).join('');
}

async function switchLanguage(lang) {
  await loadLanguage(lang);
  renderLanguageSwitcher();
  applyTranslations();
}

// Apply translations to all static elements with data-i18n attribute
function applyTranslations() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.dataset.i18n;
    const translated = t(key);
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      el.placeholder = translated;
    } else {
      el.textContent = translated;
    }
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });
  // Update context description
  const ctxDesc = document.getElementById('context-description');
  if (ctxDesc) {
    ctxDesc.textContent = t(`context.${state.context}_description`);
  }
}
