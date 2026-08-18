// Auth state — accessible to the whole app
let currentUser = null;

function getUser() { return currentUser; }
function isSignedIn() { return currentUser !== null; }

function initAuth() {
  // Listen for auth state changes (login, logout, session restore)
  onAuthStateChange(user => {
    currentUser = user;
    updateAuthUI();
    if (user) {
      console.log('Signed in:', user.email);
      handleSignedIn(user);
    } else {
      console.log('Signed out');
    }
  });
}

function updateAuthUI() {
  const authBtn    = document.getElementById('auth-btn');
  const userInfo   = document.getElementById('user-info');
  const saveBtn    = document.getElementById('save-meal-btn');
  const historyNav = document.querySelector('[data-view="history"]');
  const pantryNav  = document.querySelector('[data-view="pantry"]');
  const todayNav   = document.querySelector('[data-view="today"]');

  if (currentUser) {
    if (authBtn)    authBtn.textContent = 'Sign out';
    if (userInfo)   userInfo.textContent = currentUser.email;
    if (saveBtn)    saveBtn.style.display = 'block';
    if (historyNav) historyNav.style.display = 'inline-block';
    if (pantryNav)  pantryNav.style.display = 'inline-block';
    if (todayNav)   todayNav.style.display = 'inline-block';
  } else {
    if (authBtn)    authBtn.textContent = 'Sign in';
    if (userInfo)   userInfo.textContent = '';
    if (saveBtn)    saveBtn.style.display = 'none';
    if (historyNav) historyNav.style.display = 'none';
    if (pantryNav)  pantryNav.style.display = 'none';
    if (todayNav)   todayNav.style.display = 'none';
  }
}

async function handleAuthBtnClick() {
  if (isSignedIn()) {
    await signOut();
  } else {
    showAuthModal();
  }
}

function showAuthModal() {
  document.getElementById('auth-modal').style.display = 'flex';
}

function hideAuthModal() {
  document.getElementById('auth-modal').style.display = 'none';
  document.getElementById('auth-error').textContent = '';
}

async function handleEmailAuth(mode) {
  const email    = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value;
  const errEl    = document.getElementById('auth-error');
  errEl.textContent = '';

  if (!email || !password) {
    errEl.textContent = 'Please enter your email and password.';
    return;
  }

  const btn = document.getElementById('auth-submit-btn');
  btn.disabled = true;
  btn.textContent = mode === 'signin' ? 'Signing in...' : 'Creating account...';

  const { error } = mode === 'signin'
    ? await signInWithEmail(email, password)
    : await signUpWithEmail(email, password);

  btn.disabled = false;
  btn.textContent = mode === 'signin' ? 'Sign in' : 'Create account';

  if (error) {
    errEl.textContent = error.message;
  } else {
    hideAuthModal();
    if (mode === 'signup') {
      alert('Account created! Check your email to confirm before signing in.');
    }
  }
}

async function handleGoogleSignIn() {
  const { error } = await signInWithGoogle();
  if (error) {
    document.getElementById('auth-error').textContent = error.message;
  }
  // Google redirects away and back — auth state updates automatically
}

// Toggle between sign-in and sign-up modes in the modal
function toggleAuthMode() {
  const mode = document.getElementById('auth-mode').dataset.mode;
  const newMode = mode === 'signin' ? 'signup' : 'signin';
  document.getElementById('auth-mode').dataset.mode = newMode;
  document.getElementById('auth-modal-title').textContent =
    newMode === 'signin' ? 'Sign in' : 'Create account';
  document.getElementById('auth-submit-btn').textContent =
    newMode === 'signin' ? 'Sign in' : 'Create account';
  document.getElementById('auth-toggle-link').textContent =
    newMode === 'signin' ? 'New user? Create account' : 'Already have an account? Sign in';
  document.getElementById('auth-error').textContent = '';
}
