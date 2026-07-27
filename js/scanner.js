let html5QrCode = null;

async function startScanner() {
  const container = document.getElementById('scanner-container');
  const resultDiv = document.getElementById('scan-result');
  const stopBtn   = document.getElementById('stop-scanner');

  resultDiv.innerHTML = '<p class=\'scan-status\'>Starting camera...</p>';
  stopBtn.style.display = 'block';

  html5QrCode = new Html5Qrcode('scanner-container');

  try {
    await html5QrCode.start(
      { facingMode: 'environment' },  // rear camera on phones
      { fps: 10, qrbox: { width: 250, height: 150 } },
      async (barcode) => {
        await handleScan(barcode);
      },
      (err) => { /* ignore scan errors — they fire constantly */ }
    );
    resultDiv.innerHTML = '<p class=\'scan-status\'>Camera ready — aim at barcode.</p>';
  } catch(e) {
    resultDiv.innerHTML = `<p class='scan-error'>Camera error: ${e.message}.</p>`;
    stopBtn.style.display = 'none';
  }
}

async function stopScanner() {
  if (html5QrCode) {
    await html5QrCode.stop();
    html5QrCode = null;
  }
  document.getElementById('stop-scanner').style.display = 'none';
  document.getElementById('scanner-container').innerHTML = '';
}

async function handleScan(barcode) {
  await stopScanner();  // stop after successful scan
  const resultDiv = document.getElementById('scan-result');
  resultDiv.innerHTML = `<p class='scan-status'>Looking up barcode ${barcode}...</p>`;

  // Check local cache first
  const cached = getFromScanCache(barcode);
  if (cached) {
    showScannedProduct(cached, barcode);
    return;
  }

  // Look up via Open Food Facts
  const product = await lookupOFFByBarcode(barcode);
  if (!product) {
    resultDiv.innerHTML = `
      <p class='scan-error'>Product not found in Open Food Facts database.</p>
      <p class='scan-hint'>Try searching by name in the Packaged tab instead.</p>`;
    return;
  }

  saveToScanCache(barcode, product);
  showScannedProduct(product, barcode);
}

function showScannedProduct(product, barcode) {
  const resultDiv = document.getElementById('scan-result');
  resultDiv.innerHTML = `
    <div class='scanned-product'>
      <strong>${product.name}</strong>
      <div class='scanned-nutrients'>
        ${product.nutrients_per_100g.energy_kcal} kcal |
        Carbs: ${product.nutrients_per_100g.carbohydrate_g}g |
        Fat: ${product.nutrients_per_100g.total_fat_g}g |
        Protein: ${product.nutrients_per_100g.protein_g}g
      </div>
      <label>Amount: <input type='number' id='scan-grams' value='100'
             min='1' max='2000'> g</label>
      <button onclick='addScannedProduct()'>Add to meal</button>
    </div>`;
  // Store the product temporarily for addScannedProduct()
  window._pendingScannedProduct = product;
  updateCacheCounter();
}

function addScannedProduct() {
  const product = window._pendingScannedProduct;
  const grams = parseInt(document.getElementById('scan-grams').value);
  if (!product || !grams || grams < 1) return;
  addIngredientToMeal(product.id, grams, product);
  document.getElementById('scan-result').innerHTML =
    '<p class=\'scan-status\'>Added to meal!</p>';
  window._pendingScannedProduct = null;
}

// Local scan cache: persists across sessions via localStorage
const CACHE_KEY_PREFIX = 'scan_cache_';
const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;  // 7 days

function saveToScanCache(barcode, product) {
  try {
    localStorage.setItem(CACHE_KEY_PREFIX + barcode, JSON.stringify({
      product, timestamp: Date.now()
    }));
  } catch(e) { /* localStorage full — ignore */ }
}

function getFromScanCache(barcode) {
  try {
    const raw = localStorage.getItem(CACHE_KEY_PREFIX + barcode);
    if (!raw) return null;
    const { product, timestamp } = JSON.parse(raw);
    if (Date.now() - timestamp > CACHE_MAX_AGE_MS) {
      localStorage.removeItem(CACHE_KEY_PREFIX + barcode);
      return null;
    }
    return product;
  } catch(e) { return null; }
}

function getScanCacheSize() {
  let count = 0;
  for (let i = 0; i < localStorage.length; i++) {
    if (localStorage.key(i).startsWith(CACHE_KEY_PREFIX)) count++;
  }
  return count;
}

// Refresh the "N products in local database" counter shown in the footer.
function updateCacheCounter() {
  const el = document.getElementById('cache-counter');
  if (el) el.textContent = `${getScanCacheSize()} products in local database`;
}
