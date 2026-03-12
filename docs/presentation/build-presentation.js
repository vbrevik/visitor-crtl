#!/usr/bin/env node
/**
 * build-presentation.js — Assemble PPTX from slides.json + screenshots + avatars.
 *
 * Usage:  node build-presentation.js [slides.json] [output.pptx]
 *
 * All slide content comes from slides.json — edit that file to change
 * titles, descriptions, annotations, characters, or screenshot references.
 * Then re-run this script to regenerate the presentation.
 */

const pptxgen = require('pptxgenjs');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const BASE = __dirname;
const SLIDES_FILE = process.argv[2] || path.join(BASE, 'slides.json');
const OUTPUT_FILE = process.argv[3] || path.join(BASE, 'vms-walkthrough.pptx');
const WORKSPACE = path.join(BASE, 'workspace');

// ---------------------------------------------------------------------------
// Color palette (hex without # for PptxGenJS)
// ---------------------------------------------------------------------------
const C = {
  primary:  '1C2833',
  secondary:'2E86C1',
  accent:   'E74C3C',
  bg:       'FFFFFF',
  lightBg:  'F4F6F7',
  text:     '2C3E50',
  muted:    '7F8C8D',
  dark:     '17202A',
  white:    'FFFFFF',
  stepBg:   '2E86C1',
  storyA:   '2E86C1',
  storyB:   'E67E22',
  storyC:   '27AE60',
  storyD:   'C0392B',
};

let DATA; // loaded once in main

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function createGradientPng(filename, color1, color2, w, h) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <defs><linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:${color1}"/>
      <stop offset="100%" style="stop-color:${color2}"/>
    </linearGradient></defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
  </svg>`;
  await sharp(Buffer.from(svg)).png().toFile(filename);
  return filename;
}

function getStoryColor(storyId) {
  return C[`story${storyId}`] || C.secondary;
}

function addAvatar(s, charId, x, y, size) {
  const char = DATA.characters[charId];
  if (!char) return;
  const avatarPath = path.join(BASE, char.avatar);
  if (fs.existsSync(avatarPath)) {
    s.addImage({ path: avatarPath, x, y, w: size, h: size, rounding: true });
  }
}

function addStoryTag(s, storyId, x, y) {
  if (!storyId || !DATA.stories[storyId]) return;
  const story = DATA.stories[storyId];
  const color = getStoryColor(storyId);
  s.addShape(s._presLayout ? undefined : undefined); // not needed
  s.addText(`Story ${storyId}`, {
    x, y, w: 0.7, h: 0.25,
    fontSize: 8, fontFace: 'Arial', color: C.white,
    bold: true, align: 'center', valign: 'middle',
    fill: { color },
    rectRadius: 0.04,
    shape: 'roundRect',
  });
}

// ---------------------------------------------------------------------------
// Slide builders
// ---------------------------------------------------------------------------

function addTitleSlide(pptx, slide, bgPath) {
  const s = pptx.addSlide();
  s.background = { path: bgPath };
  s.addText(slide.title, {
    x: 0.8, y: 1.8, w: 8.4, h: 1.2,
    fontSize: 40, fontFace: 'Arial', color: C.white, bold: true, align: 'center',
  });
  s.addText(slide.subtitle, {
    x: 1.5, y: 3.1, w: 7.0, h: 0.7,
    fontSize: 18, fontFace: 'Arial', color: 'D5DBDB', align: 'center',
  });
  s.addText(DATA.meta.date, {
    x: 3.5, y: 4.0, w: 3.0, h: 0.4,
    fontSize: 14, fontFace: 'Arial', color: 'AEB6BF', align: 'center',
  });
  if (slide.notes) s.addNotes(slide.notes);
}

function addCastSlide(pptx, slide) {
  const s = pptx.addSlide();
  s.background = { fill: C.lightBg };

  // Header
  s.addShape(pptx.shapes.RECTANGLE, { x: 0, y: 0, w: 10, h: 0.8, fill: { color: C.primary } });
  s.addText(slide.title, {
    x: 0.5, y: 0.1, w: 9.0, h: 0.6,
    fontSize: 22, fontFace: 'Arial', color: C.white, bold: true,
  });

  // Description
  s.addText(slide.description, {
    x: 0.4, y: 0.95, w: 9.2, h: 0.4,
    fontSize: 11, fontFace: 'Arial', color: C.muted, align: 'center',
  });

  // Visitors row
  s.addText('VISITORS', {
    x: 0.3, y: 1.45, w: 2.0, h: 0.25,
    fontSize: 9, fontFace: 'Arial', color: C.muted, bold: true,
  });

  const visitors = slide.visitors || [];
  const vSpacing = 1.5;
  const startX = 0.3;
  visitors.forEach((charId, i) => {
    const char = DATA.characters[charId];
    if (!char) return;
    const x = startX + i * vSpacing;
    addAvatar(s, charId, x + 0.15, 1.8, 0.6);
    s.addText(char.name, {
      x, y: 2.5, w: 1.4, h: 0.3,
      fontSize: 8, fontFace: 'Arial', color: C.text, bold: true, align: 'center',
    });
    s.addText(char.role, {
      x, y: 2.75, w: 1.4, h: 0.25,
      fontSize: 7, fontFace: 'Arial', color: C.muted, align: 'center',
    });
    s.addText(char.company.length > 22 ? char.company.substring(0, 20) + '...' : char.company, {
      x, y: 2.95, w: 1.4, h: 0.25,
      fontSize: 6, fontFace: 'Arial', color: C.muted, align: 'center',
    });
  });

  // Divider
  s.addShape(pptx.shapes.RECTANGLE, { x: 0.5, y: 3.4, w: 9.0, h: 0.015, fill: { color: 'D5D8DC' } });

  // Operators row
  s.addText('SYSTEM ROLES', {
    x: 0.3, y: 3.55, w: 2.0, h: 0.25,
    fontSize: 9, fontFace: 'Arial', color: C.muted, bold: true,
  });

  const ops = slide.operators || [];
  ops.forEach((charId, i) => {
    const char = DATA.characters[charId];
    if (!char) return;
    const x = 1.5 + i * 2.5;
    addAvatar(s, charId, x + 0.35, 3.9, 0.55);
    s.addText(char.name, {
      x, y: 4.55, w: 2.0, h: 0.25,
      fontSize: 9, fontFace: 'Arial', color: C.text, bold: true, align: 'center',
    });
    s.addText(char.role, {
      x, y: 4.78, w: 2.0, h: 0.25,
      fontSize: 8, fontFace: 'Arial', color: C.muted, align: 'center',
    });
  });

  if (slide.notes) s.addNotes(slide.notes);
}

function addDiagramSlide(pptx, slide) {
  const s = pptx.addSlide();
  s.background = { fill: C.lightBg };

  s.addShape(pptx.shapes.RECTANGLE, { x: 0, y: 0, w: 10, h: 0.9, fill: { color: C.primary } });
  s.addText(slide.title, {
    x: 0.5, y: 0.1, w: 9.0, h: 0.7,
    fontSize: 22, fontFace: 'Arial', color: C.white, bold: true,
  });

  s.addText(slide.description, {
    x: 0.4, y: 1.1, w: 4.3, h: 1.5,
    fontSize: 12, fontFace: 'Arial', color: C.text, valign: 'top', wrap: true,
  });

  if (slide.bullets) {
    const bulletRows = slide.bullets.map(b => ({
      text: b, options: { bullet: true, fontSize: 11, color: C.text },
    }));
    s.addText(bulletRows, { x: 0.4, y: 2.7, w: 4.3, h: 2.5, fontFace: 'Arial', valign: 'top' });
  }

  if (slide.screenshot) {
    const imgPath = path.join(BASE, slide.screenshot);
    if (fs.existsSync(imgPath)) {
      s.addImage({ path: imgPath, x: 4.9, y: 1.1, w: 4.8, h: 4.2 });
      s.addShape(pptx.shapes.RECTANGLE, {
        x: 4.9, y: 1.1, w: 4.8, h: 4.2,
        fill: { type: 'none' }, line: { color: 'BDC3C7', width: 1 },
      });
    }
  }
  if (slide.notes) s.addNotes(slide.notes);
}

function addWalkthroughSlide(pptx, slide) {
  const s = pptx.addSlide();
  s.background = { fill: C.bg };

  // Header bar — use story color if present
  const headerColor = slide.story ? getStoryColor(slide.story) : C.primary;
  s.addShape(pptx.shapes.RECTANGLE, { x: 0, y: 0, w: 10, h: 0.8, fill: { color: C.primary } });

  // Story color accent bar at top
  if (slide.story) {
    s.addShape(pptx.shapes.RECTANGLE, { x: 0, y: 0.78, w: 10, h: 0.04, fill: { color: getStoryColor(slide.story) } });
  }

  // Step badge
  if (slide.step) {
    const badgeColor = slide.story ? getStoryColor(slide.story) : C.stepBg;
    s.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
      x: 0.3, y: 0.12, w: 0.55, h: 0.55,
      fill: { color: badgeColor }, rectRadius: 0.08,
    });
    s.addText(String(slide.step), {
      x: 0.3, y: 0.12, w: 0.55, h: 0.55,
      fontSize: 16, fontFace: 'Arial', color: C.white, bold: true, align: 'center', valign: 'middle',
    });
  }

  // Title
  s.addText(slide.title, {
    x: 1.0, y: 0.1, w: 8.5, h: 0.6,
    fontSize: 18, fontFace: 'Arial', color: C.white, bold: true,
  });

  // Screenshot
  const imgPath = slide.screenshot ? path.join(BASE, slide.screenshot) : null;
  const hasImg = imgPath && fs.existsSync(imgPath);

  if (hasImg) {
    s.addImage({ path: imgPath, x: 0.2, y: 0.95, w: 6.5, h: 4.1 });
    s.addShape(pptx.shapes.RECTANGLE, {
      x: 0.2, y: 0.95, w: 6.5, h: 4.1,
      fill: { type: 'none' }, line: { color: 'D5D8DC', width: 1 },
    });

    // Right panel — avatar + description + annotations
    const panelX = 6.9;
    let panelY = 0.95;

    // Character avatar and name
    if (slide.character) {
      const char = DATA.characters[slide.character];
      if (char) {
        addAvatar(s, slide.character, panelX + 0.05, panelY + 0.05, 0.45);
        s.addText(char.name, {
          x: panelX + 0.6, y: panelY + 0.05, w: 2.2, h: 0.25,
          fontSize: 9, fontFace: 'Arial', color: C.text, bold: true,
        });
        s.addText(char.role, {
          x: panelX + 0.6, y: panelY + 0.27, w: 2.2, h: 0.2,
          fontSize: 7, fontFace: 'Arial', color: C.muted,
        });
        panelY += 0.6;
      }
    }

    // Description box
    s.addShape(pptx.shapes.RECTANGLE, {
      x: panelX, y: panelY, w: 2.9, h: 1.6,
      fill: { color: C.lightBg }, rectRadius: 0.08,
    });
    s.addText(slide.description, {
      x: panelX + 0.12, y: panelY + 0.08, w: 2.65, h: 1.4,
      fontSize: 9, fontFace: 'Arial', color: C.text, valign: 'top', wrap: true,
    });
    panelY += 1.7;

    // Annotations
    if (slide.annotations && slide.annotations.length > 0) {
      const annColor = slide.story ? getStoryColor(slide.story) : C.secondary;
      slide.annotations.forEach((ann, i) => {
        const y = panelY + i * 0.65;
        s.addShape(pptx.shapes.RECTANGLE, {
          x: panelX, y, w: 0.06, h: 0.55,
          fill: { color: annColor },
        });
        s.addText(ann.text, {
          x: panelX + 0.15, y, w: 2.65, h: 0.55,
          fontSize: 8, fontFace: 'Arial', color: C.text, valign: 'middle', wrap: true,
        });
      });
    }
  } else {
    s.addText(slide.description, {
      x: 0.5, y: 1.1, w: 9.0, h: 1.8,
      fontSize: 14, fontFace: 'Arial', color: C.text, valign: 'top', wrap: true,
    });
  }

  s.addNotes(slide.description);
}

function addExplanationSlide(pptx, slide) {
  const s = pptx.addSlide();
  s.background = { fill: C.bg };

  s.addShape(pptx.shapes.RECTANGLE, { x: 0, y: 0, w: 10, h: 0.8, fill: { color: C.primary } });
  if (slide.step) {
    s.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
      x: 0.3, y: 0.12, w: 0.55, h: 0.55,
      fill: { color: C.accent }, rectRadius: 0.08,
    });
    s.addText(String(slide.step), {
      x: 0.3, y: 0.12, w: 0.55, h: 0.55,
      fontSize: 16, fontFace: 'Arial', color: C.white, bold: true, align: 'center', valign: 'middle',
    });
  }
  s.addText(slide.title, {
    x: 1.0, y: 0.1, w: 8.5, h: 0.6,
    fontSize: 18, fontFace: 'Arial', color: C.white, bold: true,
  });

  s.addText(slide.description, {
    x: 0.6, y: 1.1, w: 8.8, h: 2.0,
    fontSize: 13, fontFace: 'Arial', color: C.text, valign: 'top', wrap: true, lineSpacing: 20,
  });

  if (slide.bullets && slide.bullets.length > 0) {
    s.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
      x: 0.5, y: 3.2, w: 9.0, h: 2.1,
      fill: { color: C.lightBg }, rectRadius: 0.1,
    });
    const bulletRows = slide.bullets.map(b => ({
      text: b, options: { bullet: true, fontSize: 12, color: C.text },
    }));
    s.addText(bulletRows, { x: 0.8, y: 3.35, w: 8.4, h: 1.8, fontFace: 'Arial', valign: 'top' });
  }

  s.addNotes(slide.description);
}

function addStoryBreakSlide(pptx, slide, storyBgPath) {
  const s = pptx.addSlide();
  const storyColor = slide.story ? getStoryColor(slide.story) : C.primary;

  // Dark background with story color accent
  s.background = { path: storyBgPath };

  // Story color bar at top
  s.addShape(pptx.shapes.RECTANGLE, { x: 0, y: 0, w: 10, h: 0.12, fill: { color: storyColor } });

  // Avatar — large, centered
  if (slide.character) {
    addAvatar(s, slide.character, 4.1, 0.6, 1.8);
    const char = DATA.characters[slide.character];
    if (char) {
      s.addText(char.name, {
        x: 2.0, y: 2.5, w: 6.0, h: 0.4,
        fontSize: 20, fontFace: 'Arial', color: C.white, bold: true, align: 'center',
      });
      s.addText(`${char.role} — ${char.company}`, {
        x: 1.5, y: 2.9, w: 7.0, h: 0.3,
        fontSize: 12, fontFace: 'Arial', color: 'AEB6BF', align: 'center',
      });
    }
  }

  // Title
  s.addText(slide.title, {
    x: 0.8, y: 3.4, w: 8.4, h: 0.5,
    fontSize: 16, fontFace: 'Arial', color: storyColor, bold: true, align: 'center',
  });

  // Description
  s.addText(slide.description, {
    x: 1.0, y: 3.9, w: 8.0, h: 1.0,
    fontSize: 11, fontFace: 'Arial', color: 'D5DBDB', align: 'center', wrap: true, lineSpacing: 18,
  });

  // Outcome badge
  if (slide.outcome) {
    s.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
      x: 2.0, y: 4.95, w: 6.0, h: 0.35,
      fill: { color: storyColor }, rectRadius: 0.06,
    });
    s.addText(slide.outcome, {
      x: 2.0, y: 4.95, w: 6.0, h: 0.35,
      fontSize: 10, fontFace: 'Arial', color: C.white, bold: true, align: 'center', valign: 'middle',
    });
  }

  s.addNotes(slide.description);
}

function addGanttSlide(pptx, slide) {
  const s = pptx.addSlide();
  s.background = { fill: C.bg };

  // Header
  s.addShape(pptx.shapes.RECTANGLE, { x: 0, y: 0, w: 10, h: 0.8, fill: { color: C.primary } });
  s.addText(slide.title, {
    x: 0.5, y: 0.1, w: 9.0, h: 0.6,
    fontSize: 20, fontFace: 'Arial', color: C.white, bold: true,
  });

  const phases = slide.phases || [];
  const milestones = slide.milestones || [];
  const deliverables = slide.deliverables || [];

  // Gantt chart area
  const chartX = 2.2, chartY = 1.1, chartW = 7.3;
  const maxWeek = 10;
  const weekW = chartW / maxWeek;
  const barH = 0.38;
  const barGap = 0.12;

  // Week headers
  for (let w = 1; w <= maxWeek; w++) {
    const x = chartX + (w - 1) * weekW;
    s.addText(`W${w}`, {
      x, y: chartY - 0.25, w: weekW, h: 0.22,
      fontSize: 7, fontFace: 'Arial', color: C.muted, align: 'center',
    });
    // Grid line
    s.addShape(pptx.shapes.RECTANGLE, {
      x, y: chartY, w: 0.005, h: phases.length * (barH + barGap),
      fill: { color: 'ECF0F1' },
    });
  }

  // Phase bars
  phases.forEach((phase, i) => {
    const y = chartY + i * (barH + barGap);
    const barX = chartX + (phase.startWeek - 1) * weekW;
    const barW = (phase.endWeek - phase.startWeek + 1) * weekW;
    const color = C[phase.color] || C.secondary;

    // Phase label (left of bar)
    s.addText(phase.name, {
      x: 0.2, y, w: 1.9, h: barH,
      fontSize: 9, fontFace: 'Arial', color: C.text, bold: true, align: 'right', valign: 'middle',
    });

    // Bar
    s.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
      x: barX, y, w: barW, h: barH,
      fill: { color }, rectRadius: 0.06,
    });

    // Bar label
    s.addText(phase.label, {
      x: barX + 0.08, y, w: barW - 0.16, h: barH,
      fontSize: 7, fontFace: 'Arial', color: C.white, valign: 'middle', wrap: true,
    });
  });

  // Milestone diamonds
  const msY = chartY + phases.length * (barH + barGap) + 0.15;
  s.addText('MILESTONES', {
    x: 0.2, y: msY, w: 1.9, h: 0.25,
    fontSize: 8, fontFace: 'Arial', color: C.muted, bold: true, align: 'right',
  });

  milestones.forEach(ms => {
    const x = chartX + (ms.week - 1) * weekW + weekW / 2;
    // Diamond shape using rotated rectangle
    s.addShape(pptx.shapes.RECTANGLE, {
      x: x - 0.09, y: msY + 0.03, w: 0.18, h: 0.18,
      fill: { color: C.accent }, rotate: 45,
    });
    s.addText(ms.label, {
      x: x - 0.6, y: msY + 0.24, w: 1.2, h: 0.22,
      fontSize: 6, fontFace: 'Arial', color: C.text, align: 'center', wrap: true,
    });
  });

  // Deliverables list
  if (deliverables.length > 0) {
    const delY = msY + 0.55;
    s.addShape(pptx.shapes.RECTANGLE, { x: 0.3, y: delY - 0.05, w: 9.4, h: 0.02, fill: { color: 'D5D8DC' } });
    s.addText('KEY DELIVERABLES', {
      x: 0.3, y: delY + 0.02, w: 2.0, h: 0.22,
      fontSize: 8, fontFace: 'Arial', color: C.muted, bold: true,
    });
    const delRows = deliverables.map(d => ({
      text: d, options: { bullet: true, fontSize: 8, color: C.text },
    }));
    s.addText(delRows, {
      x: 0.3, y: delY + 0.25, w: 9.4, h: 1.5,
      fontFace: 'Arial', valign: 'top', lineSpacing: 14,
    });
  }

  if (slide.notes) s.addNotes(slide.notes);
}

function addBpmnSlide(pptx, slide) {
  const s = pptx.addSlide();
  s.background = { fill: C.bg };

  // Header
  s.addShape(pptx.shapes.RECTANGLE, { x: 0, y: 0, w: 10, h: 0.7, fill: { color: C.primary } });
  s.addText(slide.title, {
    x: 0.5, y: 0.05, w: 9.0, h: 0.6,
    fontSize: 17, fontFace: 'Arial', color: C.white, bold: true,
  });

  const lanes = slide.lanes || [];
  const nodes = slide.nodes || [];

  // Layout constants
  const laneX = 0.15, laneY = 0.85;
  const laneH = 0.72;
  const laneW = 9.7;
  const labelW = 0.85;
  const nodeAreaX = laneX + labelW + 0.05;
  const numCols = 13;
  const colW = (laneW - labelW - 0.15) / numCols;
  const nodeW = 0.6;
  const nodeH = 0.42;

  // Draw swim lanes
  lanes.forEach((lane, i) => {
    const y = laneY + i * laneH;
    const color = C[lane.color] || C.muted;

    // Lane background (alternating light fill)
    s.addShape(pptx.shapes.RECTANGLE, {
      x: laneX, y, w: laneW, h: laneH,
      fill: { color: i % 2 === 0 ? 'F8F9FA' : C.white },
      line: { color: 'D5D8DC', width: 0.5 },
    });

    // Lane label
    s.addShape(pptx.shapes.RECTANGLE, {
      x: laneX, y, w: labelW, h: laneH,
      fill: { color },
    });
    s.addText(lane.name, {
      x: laneX + 0.03, y, w: labelW - 0.06, h: laneH,
      fontSize: 7, fontFace: 'Arial', color: C.white, bold: true,
      align: 'center', valign: 'middle', wrap: true,
    });
  });

  // Helper to get node center position
  function nodePos(node) {
    const x = nodeAreaX + node.col * colW + colW / 2;
    const y = laneY + node.lane * laneH + laneH / 2;
    return { x, y };
  }

  // Draw flow arrows (simple lines between node centers)
  const flows = slide.flows || [];
  flows.forEach(flow => {
    const fromIdx = flow[0], toIdx = flow[1];
    const from = nodes[fromIdx], to = nodes[toIdx];
    if (!from || !to) return;
    const p1 = nodePos(from), p2 = nodePos(to);

    // Determine if this is a yes/no label
    const label = flow[2] || null;

    // Draw line using a thin rectangle
    const dx = p2.x - p1.x, dy = p2.y - p1.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 0.01) return;

    // For horizontal-ish flows, use a simple horizontal line
    if (Math.abs(dy) < 0.1) {
      const minX = Math.min(p1.x, p2.x) + nodeW / 2.5;
      const maxX = Math.max(p1.x, p2.x) - nodeW / 2.5;
      s.addShape(pptx.shapes.RECTANGLE, {
        x: minX, y: p1.y - 0.008, w: maxX - minX, h: 0.016,
        fill: { color: '95A5A6' },
      });
      // Arrowhead
      s.addShape(pptx.shapes.RECTANGLE, {
        x: maxX - 0.02, y: p1.y - 0.04, w: 0.08, h: 0.08,
        fill: { color: '95A5A6' }, rotate: 45,
      });
    } else {
      // Vertical + horizontal L-shaped connector
      // Vertical segment
      const minY = Math.min(p1.y, p2.y);
      const maxY = Math.max(p1.y, p2.y);
      s.addShape(pptx.shapes.RECTANGLE, {
        x: p1.x - 0.008, y: p1.y, w: 0.016, h: maxY - minY,
        fill: { color: '95A5A6' },
      });
      // Horizontal segment to target
      const hMinX = Math.min(p1.x, p2.x - nodeW / 2.5);
      const hMaxX = Math.max(p1.x, p2.x - nodeW / 2.5);
      s.addShape(pptx.shapes.RECTANGLE, {
        x: hMinX, y: p2.y - 0.008, w: hMaxX - hMinX, h: 0.016,
        fill: { color: '95A5A6' },
      });
    }

    // Flow label (yes/no)
    if (label) {
      const labelColor = label === 'yes' ? '27AE60' : C.accent;
      s.addText(label, {
        x: (p1.x + p2.x) / 2 - 0.15, y: Math.min(p1.y, p2.y) - 0.15,
        w: 0.3, h: 0.18,
        fontSize: 6, fontFace: 'Arial', color: labelColor, bold: true, align: 'center',
      });
    }
  });

  // Draw nodes on top of flows
  nodes.forEach(node => {
    const pos = nodePos(node);
    const cx = pos.x - nodeW / 2, cy = pos.y - nodeH / 2;

    if (node.type === 'start') {
      s.addShape(pptx.shapes.OVAL, {
        x: cx + 0.12, y: cy + 0.04, w: 0.35, h: 0.35,
        fill: { color: '27AE60' },
      });
    } else if (node.type === 'end') {
      s.addShape(pptx.shapes.OVAL, {
        x: cx + 0.1, y: cy + 0.02, w: 0.38, h: 0.38,
        fill: { color: C.accent },
        line: { color: '922B21', width: 2 },
      });
    } else if (node.type === 'gateway') {
      // Diamond (rotated rectangle)
      s.addShape(pptx.shapes.RECTANGLE, {
        x: cx + 0.12, y: cy + 0.03, w: 0.36, h: 0.36,
        fill: { color: 'F39C12' }, rotate: 45,
        line: { color: 'D68910', width: 1 },
      });
      s.addText(node.label, {
        x: cx - 0.15, y: cy + nodeH + 0.0, w: nodeW + 0.3, h: 0.28,
        fontSize: 6, fontFace: 'Arial', color: C.text, align: 'center', wrap: true,
      });
    } else {
      // Task rectangle
      const fillColor = node.optional ? 'FDEBD0' : 'EBF5FB';
      const borderColor = node.optional ? 'E67E22' : C.secondary;
      s.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
        x: cx, y: cy, w: nodeW, h: nodeH,
        fill: { color: fillColor }, rectRadius: 0.05,
        line: { color: borderColor, width: 1 },
      });
      s.addText(node.label, {
        x: cx + 0.03, y: cy + 0.02, w: nodeW - 0.06, h: nodeH - 0.04,
        fontSize: 7, fontFace: 'Arial', color: C.text, align: 'center', valign: 'middle', wrap: true,
      });
    }
  });

  // Legend at bottom
  const legY = laneY + lanes.length * laneH + 0.1;
  const legItems = [
    { shape: 'oval', color: '27AE60', label: 'Start/End Event' },
    { shape: 'rect', color: 'EBF5FB', border: C.secondary, label: 'Task' },
    { shape: 'diamond', color: 'F39C12', label: 'Gateway (Decision)' },
    { shape: 'rect', color: 'FDEBD0', border: 'E67E22', label: 'Optional Task' },
  ];
  legItems.forEach((item, i) => {
    const x = 1.2 + i * 2.3;
    if (item.shape === 'oval') {
      s.addShape(pptx.shapes.OVAL, {
        x, y: legY + 0.03, w: 0.18, h: 0.18,
        fill: { color: item.color },
      });
    } else if (item.shape === 'diamond') {
      s.addShape(pptx.shapes.RECTANGLE, {
        x: x + 0.01, y: legY + 0.03, w: 0.16, h: 0.16,
        fill: { color: item.color }, rotate: 45,
      });
    } else {
      s.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
        x, y: legY + 0.01, w: 0.22, h: 0.2,
        fill: { color: item.color }, rectRadius: 0.03,
        line: { color: item.border || item.color, width: 0.5 },
      });
    }
    s.addText(item.label, {
      x: x + 0.28, y: legY, w: 1.8, h: 0.25,
      fontSize: 7, fontFace: 'Arial', color: C.muted, valign: 'middle',
    });
  });

  if (slide.notes) s.addNotes(slide.notes);
}

// ---------------------------------------------------------------------------
// Technical slide builders
// ---------------------------------------------------------------------------

function addTechnicalSlide(pptx, slide) {
  const s = pptx.addSlide();
  s.background = { fill: C.bg };

  // Header bar with "TECHNICAL" badge
  s.addShape(pptx.shapes.RECTANGLE, { x: 0, y: 0, w: 10, h: 0.8, fill: { color: C.dark } });
  s.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
    x: 0.3, y: 0.15, w: 1.05, h: 0.5,
    fill: { color: C.accent }, rectRadius: 0.06,
  });
  s.addText('TECHNICAL', {
    x: 0.3, y: 0.15, w: 1.05, h: 0.5,
    fontSize: 9, fontFace: 'Arial', color: C.white, bold: true, align: 'center', valign: 'middle',
  });
  s.addText(slide.title, {
    x: 1.5, y: 0.1, w: 8.0, h: 0.6,
    fontSize: 18, fontFace: 'Arial', color: C.white, bold: true,
  });

  // Description
  s.addText(slide.description, {
    x: 0.4, y: 0.9, w: 9.2, h: 0.55,
    fontSize: 10, fontFace: 'Arial', color: C.text, valign: 'top', wrap: true,
  });

  // Left panel: content sections
  const sections = slide.sections || [];
  let secY = 1.5;
  sections.forEach((sec) => {
    // Section header
    s.addShape(pptx.shapes.RECTANGLE, {
      x: 0.4, y: secY, w: 0.06, h: 0.25,
      fill: { color: C.secondary },
    });
    s.addText(sec.heading, {
      x: 0.55, y: secY, w: 4.0, h: 0.25,
      fontSize: 9, fontFace: 'Arial', color: C.primary, bold: true, valign: 'middle',
    });
    secY += 0.28;

    // Section items
    if (sec.items) {
      const rows = sec.items.map(item => ({
        text: item, options: { bullet: true, fontSize: 8, color: C.text },
      }));
      const itemH = Math.min(sec.items.length * 0.17 + 0.05, 1.0);
      s.addText(rows, {
        x: 0.6, y: secY, w: 4.2, h: itemH,
        fontFace: 'Arial', valign: 'top', lineSpacing: 12,
      });
      secY += itemH + 0.06;
    }
  });

  // Right panel: justification box
  if (slide.justification) {
    s.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
      x: 5.1, y: 1.5, w: 4.5, h: 3.8,
      fill: { color: 'FEF9E7' }, rectRadius: 0.08,
      line: { color: 'F9E79F', width: 1 },
    });
    s.addText('WHY THIS DESIGN', {
      x: 5.3, y: 1.55, w: 4.0, h: 0.25,
      fontSize: 8, fontFace: 'Arial', color: 'B7950B', bold: true,
    });
    const justRows = slide.justification.map(j => ({
      text: j, options: { bullet: true, fontSize: 8, color: C.text },
    }));
    s.addText(justRows, {
      x: 5.3, y: 1.85, w: 4.1, h: 3.3,
      fontFace: 'Arial', valign: 'top', lineSpacing: 12, wrap: true,
    });
  }

  if (slide.notes) s.addNotes(slide.notes);
}

function addSchemaSlide(pptx, slide) {
  const s = pptx.addSlide();
  s.background = { fill: C.bg };

  // Header
  s.addShape(pptx.shapes.RECTANGLE, { x: 0, y: 0, w: 10, h: 0.7, fill: { color: C.dark } });
  s.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
    x: 0.3, y: 0.12, w: 0.85, h: 0.45,
    fill: { color: '8E44AD' }, rectRadius: 0.06,
  });
  s.addText('SCHEMA', {
    x: 0.3, y: 0.12, w: 0.85, h: 0.45,
    fontSize: 9, fontFace: 'Arial', color: C.white, bold: true, align: 'center', valign: 'middle',
  });
  s.addText(slide.title, {
    x: 1.3, y: 0.08, w: 8.2, h: 0.55,
    fontSize: 17, fontFace: 'Arial', color: C.white, bold: true,
  });

  // Render each table
  const tables = slide.tables || [];
  const tableCount = tables.length;
  const tableW = tableCount === 1 ? 9.2 : (9.2 / tableCount) - 0.1;
  const startX = 0.4;

  tables.forEach((tbl, tIdx) => {
    const tx = startX + tIdx * (tableW + 0.2);
    let ty = 0.85;

    // Table name
    s.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
      x: tx, y: ty, w: tableW, h: 0.32,
      fill: { color: C.primary }, rectRadius: 0.04,
    });
    s.addText(tbl.name, {
      x: tx + 0.1, y: ty, w: tableW - 0.2, h: 0.32,
      fontSize: 10, fontFace: 'Arial', color: C.white, bold: true, valign: 'middle',
    });
    ty += 0.35;

    // Column headers
    s.addShape(pptx.shapes.RECTANGLE, {
      x: tx, y: ty, w: tableW, h: 0.24,
      fill: { color: 'EBF5FB' },
    });
    const colFieldW = tableW * 0.45;
    const colTypeW = tableW * 0.35;
    const colNoteW = tableW * 0.2;
    s.addText('Field', {
      x: tx + 0.05, y: ty, w: colFieldW, h: 0.24,
      fontSize: 7, fontFace: 'Arial', color: C.muted, bold: true, valign: 'middle',
    });
    s.addText('Type', {
      x: tx + colFieldW, y: ty, w: colTypeW, h: 0.24,
      fontSize: 7, fontFace: 'Arial', color: C.muted, bold: true, valign: 'middle',
    });
    s.addText('Note', {
      x: tx + colFieldW + colTypeW, y: ty, w: colNoteW, h: 0.24,
      fontSize: 7, fontFace: 'Arial', color: C.muted, bold: true, valign: 'middle',
    });
    ty += 0.24;

    // Rows
    const fields = tbl.fields || [];
    const rowH = 0.18;
    fields.forEach((field, fIdx) => {
      const bgColor = fIdx % 2 === 0 ? C.white : 'F8F9FA';
      s.addShape(pptx.shapes.RECTANGLE, {
        x: tx, y: ty, w: tableW, h: rowH,
        fill: { color: bgColor },
      });
      s.addText(field.name, {
        x: tx + 0.05, y: ty, w: colFieldW, h: rowH,
        fontSize: 6.5, fontFace: 'Courier New', color: C.text, valign: 'middle',
      });
      s.addText(field.type, {
        x: tx + colFieldW, y: ty, w: colTypeW, h: rowH,
        fontSize: 6.5, fontFace: 'Arial', color: C.muted, valign: 'middle',
      });
      s.addText(field.note || '', {
        x: tx + colFieldW + colTypeW, y: ty, w: colNoteW, h: rowH,
        fontSize: 6, fontFace: 'Arial', color: C.muted, valign: 'middle',
      });
      ty += rowH;
    });

    // Indexes
    if (tbl.indexes) {
      ty += 0.05;
      s.addText(`Indexes: ${tbl.indexes.join(', ')}`, {
        x: tx + 0.05, y: ty, w: tableW - 0.1, h: 0.18,
        fontSize: 6, fontFace: 'Arial', color: '7D3C98', italic: true, valign: 'middle',
      });
      ty += 0.2;
    }
    // Track max Y across tables for summary placement
    if (!slide._maxTableY || ty > slide._maxTableY) slide._maxTableY = ty;
  });

  // Summary box for infrastructure tables — positioned below tallest table
  if (slide.summary) {
    const sumY = Math.max(slide._maxTableY || 0, 0.85) + 0.15;
    const sumH = Math.min(5.5 - sumY, 1.2);
    s.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
      x: 0.4, y: sumY, w: 9.2, h: sumH,
      fill: { color: C.lightBg }, rectRadius: 0.06,
    });
    s.addText('INFRASTRUCTURE TABLES (SUMMARY)', {
      x: 0.6, y: sumY + 0.05, w: 8.8, h: 0.2,
      fontSize: 7, fontFace: 'Arial', color: C.muted, bold: true,
    });
    const sumRows = slide.summary.map(item => ({
      text: item, options: { bullet: true, fontSize: 7, color: C.text },
    }));
    s.addText(sumRows, {
      x: 0.6, y: sumY + 0.28, w: 8.8, h: sumH - 0.35,
      fontFace: 'Arial', valign: 'top', lineSpacing: 12,
    });
  }

  if (slide.notes) s.addNotes(slide.notes);
}

function addRequirementsSlide(pptx, slide) {
  const s = pptx.addSlide();
  s.background = { fill: C.bg };

  // Header
  s.addShape(pptx.shapes.RECTANGLE, { x: 0, y: 0, w: 10, h: 0.7, fill: { color: C.dark } });
  s.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
    x: 0.3, y: 0.12, w: 1.2, h: 0.45,
    fill: { color: '27AE60' }, rectRadius: 0.06,
  });
  s.addText('REQUIREMENTS', {
    x: 0.3, y: 0.12, w: 1.2, h: 0.45,
    fontSize: 8, fontFace: 'Arial', color: C.white, bold: true, align: 'center', valign: 'middle',
  });
  s.addText(slide.title, {
    x: 1.65, y: 0.08, w: 7.85, h: 0.55,
    fontSize: 17, fontFace: 'Arial', color: C.white, bold: true,
  });

  // Column headers
  const headerY = 0.82;
  const colDomainW = 1.5, colCapW = 4.6, colPriW = 0.8, colRefW = 2.3;
  const colX = 0.4;
  s.addShape(pptx.shapes.RECTANGLE, {
    x: colX, y: headerY, w: 9.2, h: 0.28,
    fill: { color: C.primary },
  });
  const headers = [
    { text: 'Domain', x: colX + 0.05, w: colDomainW },
    { text: 'Capability', x: colX + colDomainW, w: colCapW },
    { text: 'Priority', x: colX + colDomainW + colCapW, w: colPriW },
    { text: 'Scenario Ref', x: colX + colDomainW + colCapW + colPriW, w: colRefW },
  ];
  headers.forEach(h => {
    s.addText(h.text, {
      x: h.x, y: headerY, w: h.w, h: 0.28,
      fontSize: 7, fontFace: 'Arial', color: C.white, bold: true, valign: 'middle',
    });
  });

  // Rows
  const reqs = slide.requirements || [];
  let rowY = headerY + 0.28;
  const rowH = 0.3;

  reqs.forEach((req, i) => {
    const bgColor = i % 2 === 0 ? C.white : 'F8F9FA';
    s.addShape(pptx.shapes.RECTANGLE, {
      x: colX, y: rowY, w: 9.2, h: rowH,
      fill: { color: bgColor },
    });

    const priColor = req.priority === 'MUST' ? 'C0392B' : req.priority === 'SHOULD' ? 'E67E22' : '27AE60';

    s.addText(req.domain, {
      x: colX + 0.05, y: rowY, w: colDomainW, h: rowH,
      fontSize: 7, fontFace: 'Arial', color: C.text, bold: true, valign: 'middle',
    });
    s.addText(req.capability, {
      x: colX + colDomainW, y: rowY, w: colCapW, h: rowH,
      fontSize: 7, fontFace: 'Arial', color: C.text, valign: 'middle', wrap: true,
    });
    s.addText(req.priority, {
      x: colX + colDomainW + colCapW, y: rowY, w: colPriW, h: rowH,
      fontSize: 7, fontFace: 'Arial', color: priColor, bold: true, valign: 'middle', align: 'center',
    });
    s.addText(req.ref || '', {
      x: colX + colDomainW + colCapW + colPriW, y: rowY, w: colRefW, h: rowH,
      fontSize: 7, fontFace: 'Arial', color: C.muted, valign: 'middle',
    });

    rowY += rowH;
  });

  if (slide.notes) s.addNotes(slide.notes);
}

function addStateMachineSlide(pptx, slide) {
  const s = pptx.addSlide();
  s.background = { fill: C.bg };

  // Header
  s.addShape(pptx.shapes.RECTANGLE, { x: 0, y: 0, w: 10, h: 0.7, fill: { color: C.dark } });
  s.addText(slide.title, {
    x: 0.5, y: 0.08, w: 9.0, h: 0.55,
    fontSize: 17, fontFace: 'Arial', color: C.white, bold: true,
  });

  // Render each machine — stack vertically with dynamic Y
  const machines = slide.machines || [];
  let nextY = 0.85;
  machines.forEach((machine) => {
    const isMain = machine.main;
    const machineY = nextY;

    // Machine label
    s.addText(machine.label, {
      x: 0.4, y: machineY, w: 3.0, h: 0.25,
      fontSize: 10, fontFace: 'Arial', color: C.primary, bold: true,
    });

    // States as boxes with arrows
    const states = machine.states || [];
    const stateW = isMain ? 0.95 : 1.1;
    const stateH = isMain ? 0.4 : 0.32;
    const gap = 0.08;
    const totalW = states.length * stateW + (states.length - 1) * gap;
    const startX = isMain ? Math.max((10 - totalW) / 2, 0.3) : 0.5;
    const stateY = machineY + 0.3;

    states.forEach((state, sIdx) => {
      const sx = startX + sIdx * (stateW + gap);
      const isStart = sIdx === 0;
      const isEnd = state.terminal;
      const fillColor = state.blocked ? 'FADBD8' :
                        isEnd ? 'D5F5E3' :
                        isStart ? 'EBF5FB' : C.lightBg;
      const borderColor = state.blocked ? C.accent :
                          isEnd ? '27AE60' :
                          isStart ? C.secondary : 'BDC3C7';

      s.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
        x: sx, y: stateY, w: stateW, h: stateH,
        fill: { color: fillColor }, rectRadius: 0.06,
        line: { color: borderColor, width: 1 },
      });
      s.addText(state.name, {
        x: sx + 0.03, y: stateY, w: stateW - 0.06, h: stateH,
        fontSize: 7, fontFace: 'Arial', color: C.text, align: 'center', valign: 'middle', wrap: true,
      });

      // Arrow to next state
      if (sIdx < states.length - 1 && !state.branch) {
        const arrowX = sx + stateW;
        s.addShape(pptx.shapes.RECTANGLE, {
          x: arrowX, y: stateY + stateH / 2 - 0.008, w: gap, h: 0.016,
          fill: { color: '95A5A6' },
        });
      }
    });

    // Branch labels if present
    let branchEndY = stateY + stateH;
    if (machine.branches) {
      machine.branches.forEach(branch => {
        const bY = stateY + stateH + 0.05;
        s.addText(branch.label, {
          x: branch.x || 0.5, y: bY,
          w: 3.5, h: 0.2,
          fontSize: 6, fontFace: 'Arial', color: C.muted, italic: true, wrap: true,
        });
        branchEndY = Math.max(branchEndY, bY + 0.2);
      });
    }

    // Advance Y for next machine
    nextY = branchEndY + 0.3;
  });

  if (slide.notes) s.addNotes(slide.notes);
}

function addDecisionLogSlide(pptx, slide) {
  const s = pptx.addSlide();
  s.background = { fill: C.bg };

  // Header
  s.addShape(pptx.shapes.RECTANGLE, { x: 0, y: 0, w: 10, h: 0.7, fill: { color: C.dark } });
  s.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
    x: 0.3, y: 0.12, w: 1.1, h: 0.45,
    fill: { color: 'E67E22' }, rectRadius: 0.06,
  });
  s.addText('DECISIONS', {
    x: 0.3, y: 0.12, w: 1.1, h: 0.45,
    fontSize: 9, fontFace: 'Arial', color: C.white, bold: true, align: 'center', valign: 'middle',
  });
  s.addText(slide.title, {
    x: 1.55, y: 0.08, w: 8.0, h: 0.55,
    fontSize: 17, fontFace: 'Arial', color: C.white, bold: true,
  });

  // Table headers
  const headerY = 0.82;
  const colDecW = 2.0, colOptsW = 2.5, colChosenW = 1.6, colRatW = 3.1;
  const colX = 0.4;
  s.addShape(pptx.shapes.RECTANGLE, {
    x: colX, y: headerY, w: 9.2, h: 0.28,
    fill: { color: C.primary },
  });
  const headers = [
    { text: 'Decision', x: colX + 0.05, w: colDecW },
    { text: 'Options Considered', x: colX + colDecW, w: colOptsW },
    { text: 'Chosen', x: colX + colDecW + colOptsW, w: colChosenW },
    { text: 'Rationale', x: colX + colDecW + colOptsW + colChosenW, w: colRatW },
  ];
  headers.forEach(h => {
    s.addText(h.text, {
      x: h.x, y: headerY, w: h.w, h: 0.28,
      fontSize: 7, fontFace: 'Arial', color: C.white, bold: true, valign: 'middle',
    });
  });

  // Rows
  const decisions = slide.decisions || [];
  let rowY = headerY + 0.28;
  const rowH = 0.45;

  decisions.forEach((dec, i) => {
    const bgColor = i % 2 === 0 ? C.white : 'F8F9FA';
    s.addShape(pptx.shapes.RECTANGLE, {
      x: colX, y: rowY, w: 9.2, h: rowH,
      fill: { color: bgColor },
    });
    s.addText(dec.decision, {
      x: colX + 0.05, y: rowY, w: colDecW, h: rowH,
      fontSize: 6.5, fontFace: 'Arial', color: C.text, bold: true, valign: 'middle', wrap: true,
    });
    s.addText(dec.options, {
      x: colX + colDecW, y: rowY, w: colOptsW, h: rowH,
      fontSize: 6.5, fontFace: 'Arial', color: C.muted, valign: 'middle', wrap: true,
    });
    s.addText(dec.chosen, {
      x: colX + colDecW + colOptsW, y: rowY, w: colChosenW, h: rowH,
      fontSize: 6.5, fontFace: 'Arial', color: '27AE60', bold: true, valign: 'middle', wrap: true,
    });
    s.addText(dec.rationale, {
      x: colX + colDecW + colOptsW + colChosenW, y: rowY, w: colRatW, h: rowH,
      fontSize: 6.5, fontFace: 'Arial', color: C.text, valign: 'middle', wrap: true,
    });
    rowY += rowH;
  });

  if (slide.notes) s.addNotes(slide.notes);
}

function addComplianceSlide(pptx, slide) {
  const s = pptx.addSlide();
  s.background = { fill: C.bg };

  // Header
  s.addShape(pptx.shapes.RECTANGLE, { x: 0, y: 0, w: 10, h: 0.7, fill: { color: C.dark } });
  s.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
    x: 0.3, y: 0.12, w: 1.2, h: 0.45,
    fill: { color: '2E86C1' }, rectRadius: 0.06,
  });
  s.addText('COMPLIANCE', {
    x: 0.3, y: 0.12, w: 1.2, h: 0.45,
    fontSize: 8, fontFace: 'Arial', color: C.white, bold: true, align: 'center', valign: 'middle',
  });
  s.addText(slide.title, {
    x: 1.65, y: 0.08, w: 7.85, h: 0.55,
    fontSize: 17, fontFace: 'Arial', color: C.white, bold: true,
  });

  // Table headers
  const headerY = 0.82;
  const colSrcW = 1.8, colReqW = 3.7, colAddrW = 3.7;
  const colX = 0.4;
  s.addShape(pptx.shapes.RECTANGLE, {
    x: colX, y: headerY, w: 9.2, h: 0.28,
    fill: { color: C.primary },
  });
  [
    { text: 'Framework', x: colX + 0.05, w: colSrcW },
    { text: 'Requirement', x: colX + colSrcW, w: colReqW },
    { text: 'How Addressed', x: colX + colSrcW + colReqW, w: colAddrW },
  ].forEach(h => {
    s.addText(h.text, {
      x: h.x, y: headerY, w: h.w, h: 0.28,
      fontSize: 7, fontFace: 'Arial', color: C.white, bold: true, valign: 'middle',
    });
  });

  // Rows
  const mappings = slide.mappings || [];
  let rowY = headerY + 0.28;
  const rowH = 0.35;

  mappings.forEach((m, i) => {
    const bgColor = i % 2 === 0 ? C.white : 'F8F9FA';
    s.addShape(pptx.shapes.RECTANGLE, {
      x: colX, y: rowY, w: 9.2, h: rowH,
      fill: { color: bgColor },
    });
    s.addText(m.source, {
      x: colX + 0.05, y: rowY, w: colSrcW, h: rowH,
      fontSize: 6.5, fontFace: 'Arial', color: C.text, bold: true, valign: 'middle', wrap: true,
    });
    s.addText(m.requirement, {
      x: colX + colSrcW, y: rowY, w: colReqW, h: rowH,
      fontSize: 6.5, fontFace: 'Arial', color: C.text, valign: 'middle', wrap: true,
    });
    s.addText(m.addressed, {
      x: colX + colSrcW + colReqW, y: rowY, w: colAddrW, h: rowH,
      fontSize: 6.5, fontFace: 'Arial', color: C.text, valign: 'middle', wrap: true,
    });
    rowY += rowH;
  });

  if (slide.notes) s.addNotes(slide.notes);
}

function addSectionBreakSlide(pptx, slide, bgPath) {
  const s = pptx.addSlide();
  s.background = { path: bgPath };

  s.addText(slide.title, {
    x: 0.8, y: 2.0, w: 8.4, h: 0.8,
    fontSize: 32, fontFace: 'Arial', color: C.white, bold: true, align: 'center',
  });
  if (slide.subtitle) {
    s.addText(slide.subtitle, {
      x: 1.5, y: 2.9, w: 7.0, h: 0.5,
      fontSize: 16, fontFace: 'Arial', color: 'AEB6BF', align: 'center',
    });
  }

  if (slide.notes) s.addNotes(slide.notes);
}

function addClosingSlide(pptx, slide, bgPath) {
  const s = pptx.addSlide();
  s.background = { path: bgPath };

  s.addText(slide.title, {
    x: 0.8, y: 0.5, w: 8.4, h: 0.8,
    fontSize: 28, fontFace: 'Arial', color: C.white, bold: true, align: 'center',
  });

  if (slide.bullets) {
    const storyColors = { A: C.storyA, B: C.storyB, C: C.storyC, D: C.storyD };
    const bulletRows = slide.bullets.map(b => {
      // Color-code story bullets
      const storyMatch = b.match(/^Story ([A-D])/);
      const color = storyMatch ? storyColors[storyMatch[1]] || 'D5DBDB' : 'D5DBDB';
      return { text: b, options: { bullet: true, fontSize: 13, color } };
    });
    s.addText(bulletRows, {
      x: 1.2, y: 1.5, w: 7.6, h: 3.5,
      fontFace: 'Arial', valign: 'top', lineSpacing: 22,
    });
  }

  if (slide.notes) s.addNotes(slide.notes);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log('Reading slides from:', SLIDES_FILE);
  DATA = JSON.parse(fs.readFileSync(SLIDES_FILE, 'utf-8'));

  fs.mkdirSync(WORKSPACE, { recursive: true });

  const titleBg = path.join(WORKSPACE, 'title-bg.png');
  const closingBg = path.join(WORKSPACE, 'closing-bg.png');
  const storyBg = path.join(WORKSPACE, 'story-bg.png');
  await createGradientPng(titleBg, '#1C2833', '#2E4053', 1920, 1080);
  await createGradientPng(closingBg, '#17202A', '#1C2833', 1920, 1080);
  await createGradientPng(storyBg, '#1B2631', '#212F3D', 1920, 1080);

  const pptx = new pptxgen();
  pptx.layout = 'LAYOUT_16x9';
  pptx.author = DATA.meta.author || 'VMS Team';
  pptx.title = DATA.meta.title || 'VMS Walkthrough';

  for (const slide of DATA.slides) {
    console.log(`  Building: ${slide.id} (${slide.type})`);
    switch (slide.type) {
      case 'title':       addTitleSlide(pptx, slide, titleBg); break;
      case 'cast':        addCastSlide(pptx, slide); break;
      case 'diagram':     addDiagramSlide(pptx, slide); break;
      case 'walkthrough': addWalkthroughSlide(pptx, slide); break;
      case 'explanation': addExplanationSlide(pptx, slide); break;
      case 'gantt':       addGanttSlide(pptx, slide); break;
      case 'bpmn':        addBpmnSlide(pptx, slide); break;
      case 'story-break':    addStoryBreakSlide(pptx, slide, storyBg); break;
      case 'technical':      addTechnicalSlide(pptx, slide); break;
      case 'schema':         addSchemaSlide(pptx, slide); break;
      case 'requirements':   addRequirementsSlide(pptx, slide); break;
      case 'state-machine':  addStateMachineSlide(pptx, slide); break;
      case 'decision-log':   addDecisionLogSlide(pptx, slide); break;
      case 'compliance':     addComplianceSlide(pptx, slide); break;
      case 'section-break':  addSectionBreakSlide(pptx, slide, closingBg); break;
      case 'closing':        addClosingSlide(pptx, slide, closingBg); break;
      default: console.warn(`  Unknown slide type: ${slide.type}`);
    }
  }

  await pptx.writeFile({ fileName: OUTPUT_FILE });
  console.log(`\nPresentation saved to: ${OUTPUT_FILE}`);
  console.log(`Total slides: ${DATA.slides.length}`);
}

main().catch(err => { console.error('Build failed:', err); process.exit(1); });
