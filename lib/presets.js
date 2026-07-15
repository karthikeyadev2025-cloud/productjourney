// lib/presets.js — reusable creative controls

export const SCENES = [
  { key: 'copy_only', label: 'Copywriting Only (No Renders)', prompt: 'NONE', needsModel: false },
  { key: 'marble',  label: 'Marble luxury',   prompt: 'Clean transparent-style product cutout resting on a luxury white-and-grey Calacatta marble surface, soft diffused jewelry studio lighting, clean soft ambient shadows beneath the product, minimal premium catalog look.', needsModel: false },
  { key: 'model',   label: 'Model editorial', prompt: "Worn or posed naturally on {MODEL}, close-up editorial fashion photograph, flawless skin, soft ambient lighting, high-end jewelry commercial style.", needsModel: true },
  { key: 'golden',  label: 'Golden hour',     prompt: "Held or worn elegantly by {MODEL} outdoors during golden hour, warm sunset backlight, subtle soft lens flare, dreamy cream bokeh background, premium lifestyle campaign photograph.", needsModel: true },
  { key: 'silk',    label: 'Silk flat-lay',   prompt: 'Set standalone as a luxury lifestyle flat-lay on flowing champagne silk fabric, elegant gentle folds catching soft directional light, top-down composition, refined and airy.', needsModel: false },
  { key: 'velvet',  label: 'Boutique box',    prompt: 'Nestled inside a premium dark velvet-lined jewelry boutique box under a single warm studio spotlight, dark moody background, dramatic high-end commercial presentation.', needsModel: false },
  { key: 'macro',   label: 'Macro detail',    prompt: "Posed or held close to {MODEL}, extreme macro detail shot, every metal surface and polished facet crisp and radiant, soft neutral blurred studio backdrop.", needsModel: true }
];

export const GENDERS = [
  { key: 'female', label: 'Female', phrase: 'an elegant female model' },
  { key: 'male',   label: 'Male',   phrase: 'a refined male model' },
  { key: 'mixed',  label: 'Mixed',  phrase: 'a stylish model' }
];

// Each preset carries gender-specific phrasing so male-bridal doesn't inherit female clothing.
export const PRESETS = [
  { key: 'indian_bridal', label: 'Indian bridal', phrases: {
    female: 'a South Asian bride wearing a rich crimson silk saree, intricate gold embroidery, natural elegant bridal makeup, and delicate mehndi details on skin',
    male:   'a South Asian groom in an ivory-and-gold silk sherwani, ornate turban, and sharp grooming',
    mixed:  'a South Asian bridal model in traditional red-and-gold silk wedding attire'
  }},
  { key: 'indian_modern', label: 'Indian modern', phrases: {
    female: 'a modern South Asian woman wearing minimalist contemporary designer wear, soft radiant natural makeup, styled in a warm chic interior',
    male:   'a modern South Asian man wearing a tailored contemporary designer outfit, sharp grooming, natural styling',
    mixed:  'a modern South Asian model wearing minimalist contemporary designer wear, soft natural styling'
  }},
  { key: 'western_edit',  label: 'Western editorial', phrases: {
    female: 'a chic Western fashion model in high-end minimalist editorial apparel, subtle clean-girl makeup, professional studio neutral lighting',
    male:   'a Western fashion model in a sharply tailored minimalist suit, clean-cut styling, neutral studio lighting',
    mixed:  'a Western fashion model in minimalist high-fashion attire, clean-cut styling'
  }},
  { key: 'middle_east',   label: 'Middle-Eastern', phrases: {
    female: 'a Middle-Eastern woman in a luxurious modern abaya, soft dewy makeup, elegant regal styling, in a modern luxury villa lounge',
    male:   'a Middle-Eastern man in a pristine white thobe and bisht with refined gold embroidery, clean royal grooming',
    mixed:  'a Middle-Eastern model in elegant royal attire, sophisticated styling'
  }},
  { key: 'east_asian',    label: 'East Asian', phrases: {
    female: 'an East Asian fashion model in minimalist designer apparel, soft natural makeup, sleek hair, warm minimalist studio lighting',
    male:   'an East Asian man in a minimalist designer outfit, refined contemporary grooming, warm studio styling',
    mixed:  'an East Asian model in a minimalist modern outfit, soft natural styling'
  }},
  { key: 'african',       label: 'African elegance', phrases: {
    female: 'a beautiful African model with glowing radiant skin tones, wearing contemporary minimalist designer wear, natural makeup, editorial portrait lighting',
    male:   'a handsome African man in a bold contemporary designer outfit, radiant skin tones, confident styling',
    mixed:  'an African model in a bold contemporary outfit, radiant skin tones'
  }},
  { key: 'clean',         label: 'Clean / unspecified', phrases: {
    female: 'an elegant female model with soft neutral styling',
    male:   'a refined male model with soft neutral styling',
    mixed:  'a stylish model with soft neutral styling'
  }}
];

export const ANGLES = [
  { key: 'front', label: 'Front',   phrase: 'shot from the front, symmetrical composition' },
  { key: 'side',  label: 'Side',    phrase: 'shot from a clean side profile angle' },
  { key: 'angle', label: '45°',     phrase: 'shot from a 45-degree three-quarter angle' },
  { key: 'back',  label: 'Back',    phrase: 'shot from behind, showing the clasp and reverse detail' },
  { key: 'top',   label: 'Top-down',phrase: 'shot from directly above in top-down composition' }
];

/**
 * Build the model phrase used to interpolate {MODEL} in scene prompts.
 * Uses whichever cultural preset is chosen, biased with gender.
 */
export function buildModelPhrase({ gender = 'female', preset = 'clean' }) {
  const p = PRESETS.find(x => x.key === preset) || PRESETS[PRESETS.length - 1];
  const g = ['female','male','mixed'].includes(gender) ? gender : 'female';
  return p.phrases[g] || p.phrases.female;
}

export function resolveScenes(sceneKeys) {
  const chosen = sceneKeys && sceneKeys.length
    ? sceneKeys.map(k => SCENES.find(s => s.key === k)).filter(Boolean)
    : SCENES.slice(0, 4);
  return chosen;
}

export function resolveAngles(angleKeys) {
  if (!angleKeys || !angleKeys.length) return [];
  return angleKeys.map(k => ANGLES.find(a => a.key === k)).filter(Boolean);
}
