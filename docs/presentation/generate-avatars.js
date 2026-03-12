#!/usr/bin/env node
/**
 * generate-avatars.js — Create distinctive avatar PNGs for each story character.
 * Uses SVG → PNG via Sharp. Each avatar has initials, unique color, and role icon.
 */

const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, 'avatars');
fs.mkdirSync(OUT, { recursive: true });

const CHARS = [
  { id: 'anna',    initials: 'AL', name: 'Anna Lindqvist',     color: '#2E86C1', accent: '#1A5276', role: 'visitor' },
  { id: 'thomas',  initials: 'TM', name: 'Thomas Müller',      color: '#E67E22', accent: '#A04000', role: 'visitor' },
  { id: 'petter',  initials: 'PS', name: 'Petter Svendsen',    color: '#27AE60', accent: '#1E8449', role: 'delivery' },
  { id: 'ivan',    initials: 'IP', name: 'Ivan Petrov',        color: '#C0392B', accent: '#922B21', role: 'visitor' },
  { id: 'marte',   initials: 'MH', name: 'Marte Haugen',       color: '#8E44AD', accent: '#6C3483', role: 'employee' },
  { id: 'fatima',  initials: 'FA', name: 'Fatima Al-Rashid',    color: '#16A085', accent: '#0E6655', role: 'visitor' },
  // System roles
  { id: 'sponsor', initials: 'OH', name: 'Maj. Ola Hansen',    color: '#2C3E50', accent: '#1B2631', role: 'sponsor' },
  { id: 'guard',   initials: 'PO', name: 'Korp. P. Olsen',     color: '#34495E', accent: '#1C2833', role: 'guard' },
  { id: 'security',initials: 'EB', name: 'Kapt. Eva Berg',     color: '#7D3C98', accent: '#512E5F', role: 'security' },
];

// Role icons (simple SVG paths)
const roleIcons = {
  visitor:  '<circle cx="80" cy="155" r="8" fill="white" opacity="0.4"/><circle cx="80" cy="148" r="5" fill="white" opacity="0.4"/>',
  delivery: '<rect x="72" y="148" width="16" height="12" rx="2" fill="white" opacity="0.4"/><line x1="76" y1="152" x2="84" y2="152" stroke="white" opacity="0.3" stroke-width="1.5"/>',
  employee: '<polygon points="80,146 87,160 73,160" fill="white" opacity="0.4"/>',
  sponsor:  '<rect x="73" y="148" width="14" height="10" rx="1" fill="white" opacity="0.4"/><line x1="73" y1="152" x2="87" y2="152" stroke="white" opacity="0.3" stroke-width="1"/>',
  guard:    '<path d="M80 146 L88 150 L88 157 L80 162 L72 157 L72 150 Z" fill="white" opacity="0.4"/>',
  security: '<circle cx="80" cy="154" r="8" fill="none" stroke="white" opacity="0.4" stroke-width="1.5"/><line x1="80" y1="150" x2="80" y2="155" stroke="white" opacity="0.4" stroke-width="1.5"/><circle cx="80" cy="148" r="1" fill="white" opacity="0.4"/>',
};

async function generateAvatar(char) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160">
    <defs>
      <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" style="stop-color:${char.color}"/>
        <stop offset="100%" style="stop-color:${char.accent}"/>
      </linearGradient>
    </defs>
    <!-- Background circle -->
    <circle cx="80" cy="80" r="78" fill="url(#bg)" stroke="${char.accent}" stroke-width="3"/>
    <!-- Initials -->
    <text x="80" y="90" text-anchor="middle" font-family="Arial, sans-serif"
          font-size="52" font-weight="bold" fill="white" letter-spacing="2">
      ${char.initials}
    </text>
    <!-- Name below (small) -->
    <text x="80" y="120" text-anchor="middle" font-family="Arial, sans-serif"
          font-size="11" fill="white" opacity="0.8">
      ${char.name.length > 18 ? char.name.substring(0, 16) + '...' : char.name}
    </text>
    <!-- Role indicator -->
    ${roleIcons[char.role] || ''}
  </svg>`;

  const outPath = path.join(OUT, `${char.id}.png`);
  await sharp(Buffer.from(svg)).png().toFile(outPath);
  return outPath;
}

async function main() {
  console.log('🎭 Generating avatars...');
  for (const char of CHARS) {
    const p = await generateAvatar(char);
    console.log(`  ${char.initials} — ${char.name} → ${path.basename(p)}`);
  }
  console.log(`\n✅ ${CHARS.length} avatars saved to ${OUT}`);
}

main().catch(err => { console.error(err); process.exit(1); });
