const { createCanvas } = require('canvas');
const fs = require('fs');
const path = require('path');

function generateIcon(size, outputPath, padding = 0) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  const p = size * padding;

  // Background
  ctx.fillStyle = '#1A2D45';
  ctx.fillRect(0, 0, size, size);

  // Teal accent circle
  ctx.fillStyle = '#00796B';
  ctx.beginPath();
  ctx.arc(size - p - size*0.22, p + size*0.22, size*0.16, 0, Math.PI*2);
  ctx.fill();

  // DR text
  ctx.fillStyle = 'white';
  ctx.font = `bold ${size * 0.35}px Arial`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('DR', size/2, size/2 + p*0.1);

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, canvas.toBuffer('image/png'));
  console.log('Generated:', outputPath);
}

generateIcon(192, 'icons/icon-192.png');
generateIcon(512, 'icons/icon-512.png');
generateIcon(512, 'icons/icon-maskable.png', 0.1);
