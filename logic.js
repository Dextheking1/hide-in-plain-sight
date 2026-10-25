/*
 * Hide in Plain Sight - core logic.
 * Pure functions, shared by the browser app and the node tests.
 * A picture hides a word as an acrostic: the depicted objects, read in
 * order, start with the letters of the secret.
 */
(function (root) {
  'use strict';

  var API_URL = 'https://gen.pollinations.ai/v1/chat/completions';
  var DEFAULT_MODEL = 'anthropic/claude-fable-5.1';

  var OBJECT_IDEAS = {
    A: ['apple', 'anchor', 'acorn'],
    B: ['balloon', 'boat', 'butterfly'],
    C: ['cat', 'candle', 'cloud'],
    D: ['duck', 'dog', 'drum'],
    E: ['elephant', 'egg', 'envelope'],
    F: ['fish', 'flower', 'fox'],
    G: ['grapes', 'guitar', 'goose'],
    H: ['house', 'hat', 'horse'],
    I: ['ice cream', 'island', 'igloo'],
    J: ['jellyfish', 'jug', 'jacket'],
    K: ['kite', 'key', 'koala'],
    L: ['lion', 'lamp', 'lighthouse'],
    M: ['moon', 'mushroom', 'mouse'],
    N: ['nest', 'nut', 'notebook'],
    O: ['owl', 'orange', 'octopus'],
    P: ['penguin', 'pear', 'piano'],
    Q: ['queen', 'quilt', 'quill'],
    R: ['rocket', 'rainbow', 'rabbit'],
    S: ['snake', 'star', 'sun'],
    T: ['tree', 'turtle', 'train'],
    U: ['umbrella', 'unicorn', 'urn'],
    V: ['vase', 'violin', 'van'],
    W: ['whale', 'watch', 'wolf'],
    X: ['xylophone', 'x-ray fish', 'box'],
    Y: ['yacht', 'yarn', 'yak'],
    Z: ['zebra', 'zipper', 'zeppelin']
  };

  /* One drawable object per letter, used by the built-in demo illustrator. */
  var MOCK_OBJECT = {
    A: 'apple', B: 'balloon', C: 'cat', D: 'duck', E: 'elephant',
    F: 'fish', G: 'grapes', H: 'house', I: 'ice cream', J: 'jellyfish',
    K: 'kite', L: 'lion', M: 'moon', N: 'nest', O: 'owl',
    P: 'penguin', Q: 'queen', R: 'rocket', S: 'snake', T: 'tree',
    U: 'umbrella', V: 'vase', W: 'whale', X: 'xylophone', Y: 'yacht',
    Z: 'zebra'
  };

  function sanitizeSecret(input) {
    return String(input || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 16);
  }

  function acrosticOf(objects) {
    return (objects || []).map(function (o) {
      return String(o || '').trim().charAt(0).toUpperCase();
    }).join('');
  }

  function verifyAcrostic(objects, secret) {
    return acrosticOf(objects) === sanitizeSecret(secret);
  }

  function buildHideMessages(secret, theme) {
    var clean = sanitizeSecret(secret);
    var letters = clean.split('');
    var lines = letters.map(function (letter, i) {
      return (i + 1) + '. letter ' + letter + ': pick one of ' +
        (OBJECT_IDEAS[letter] || []).join(', ') + ', or another ordinary object starting with ' + letter;
    });
    var system = [
      'You are the illustrator engine of a steganography toy.',
      'You draw pictures as SVG code. Each picture hides a word as an acrostic:',
      'the objects in the scene, read left to right, start with the letters of the secret word.',
      'The picture itself must look like an ordinary, charming illustration.',
      'Nothing in the picture may spell the word out: no text, no letters, no numbers.'
    ].join(' ');
    var user = [
      'Draw one flat illustration, viewBox="0 0 800 600", theme: ' + (theme || 'meadow') + '.',
      'Hide this secret word: ' + clean + ' (' + letters.join(', ') + ').',
      'Include exactly one main object per letter, in this order:',
      lines.join('\n'),
      'Rules for the SVG:',
      '- Put each main object in its own group: <g data-name="objectname"> ... </g>, lowercase name.',
      '- Arrange the main objects left to right in the letter order, on a shared ground line, clearly recognizable, similar sizes.',
      '- Background scenery (sky, hills, grass, clouds) is welcome, but no extra prominent objects that could be mistaken for part of the row.',
      '- Only basic SVG shapes and paths. No external images, fonts, scripts or links. No text elements.',
      'Reply with ONLY a JSON object, no markdown fences, in this shape:',
      '{"title": "short title", "objects": ["name1", "name2"], "svg": "<svg ...>...</svg>"}',
      'The objects list must match the data-name groups in the SVG, in order.'
    ].join('\n');
    return [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ];
  }

  function buildHideRetryMessage(secret, previousObjects) {
    return [
      'The objects you picked were: ' + (previousObjects || []).join(', ') + '.',
      'They spell "' + acrosticOf(previousObjects) + '", but the secret is "' + sanitizeSecret(secret) + '".',
      'Redraw the whole picture with objects that spell the secret exactly, same rules as before.',
      'Reply with ONLY the corrected JSON object.'
    ].join('\n');
  }

  function buildRevealMessages(svg) {
    var code = String(svg || '').slice(0, 24000);
    var system = [
      'You are a steganalysis assistant. You receive only the code of an SVG illustration.',
      'A message may be hidden in the picture. You have never seen this picture before and you do not know the answer.'
    ].join(' ');
    var user = [
      'Look hard at this SVG. Is anything hidden in it?',
      'First check the acrostic: the main depicted objects (the data-name groups, and what the shapes depict),',
      'read left to right. Do their first letters spell a word?',
      'Also briefly consider other simple hiding places: counts of repeated elements, initials in element ids,',
      'first letters of color names. Do not invent a message that is not there.',
      'Reply with ONLY a JSON object, no markdown fences, in this shape:',
      '{"found": true or false, "message": "the hidden message, or empty", "method": "how it was hidden", "objects": ["object names in order"], "confidence": "high, medium or low", "notes": "one short sentence"}',
      'SVG code:',
      code
    ].join('\n');
    return [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ];
  }

  function extractJson(text) {
    if (!text) return null;
    var raw = String(text).trim();
    var fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) raw = fenced[1].trim();
    try { return JSON.parse(raw); } catch (e) { /* fall through */ }
    var start = raw.indexOf('{');
    var end = raw.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try { return JSON.parse(raw.slice(start, end + 1)); } catch (e) { return null; }
    }
    return null;
  }

  function extractSvg(text) {
    if (!text) return null;
    var m = String(text).match(/<svg[\s\S]*?<\/svg>/i);
    return m ? m[0] : null;
  }

  function objectsFromSvg(svg) {
    var names = [];
    var re = /data-name="([^"]+)"/g;
    var m;
    while ((m = re.exec(String(svg || ''))) !== null) names.push(m[1]);
    return names;
  }

  /*
   * The gateway sometimes answers a premium model request with a plain
   * low-balance notice as the message content (HTTP 200, zero tokens),
   * when the key's balance type does not cover that model.
   */
  function isBalanceNotice(text) {
    var t = String(text || '');
    return t.indexOf('enough credits') >= 0 && t.indexOf('paid Pollen') >= 0;
  }

  function parseHideResponse(text) {
    var parsed = extractJson(text);
    if (parsed && parsed.svg) {
      var svg = extractSvg(parsed.svg);
      if (svg) {
        var objects = Array.isArray(parsed.objects) && parsed.objects.length
          ? parsed.objects.map(function (o) { return String(o); })
          : objectsFromSvg(svg);
        return { title: String(parsed.title || 'A hidden picture'), objects: objects, svg: svg };
      }
    }
    var bare = extractSvg(text);
    if (bare) return { title: 'A hidden picture', objects: objectsFromSvg(bare), svg: bare };
    return null;
  }

  function parseRevealResponse(text) {
    var parsed = extractJson(text);
    if (!parsed) return null;
    return {
      found: !!parsed.found,
      message: String(parsed.message || ''),
      method: String(parsed.method || ''),
      objects: Array.isArray(parsed.objects) ? parsed.objects.map(String) : [],
      confidence: String(parsed.confidence || ''),
      notes: String(parsed.notes || '')
    };
  }

  /*
   * Light filter for model-written SVG before it goes into the page.
   * Strips scripts, foreign objects, event handlers and javascript: URLs.
   */
  function sanitizeSvg(svg) {
    var out = String(svg || '');
    out = out.replace(/<script[\s\S]*?<\/script>/gi, '');
    out = out.replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '');
    out = out.replace(/\son\w+\s*=\s*"[^"]*"/gi, '');
    out = out.replace(/\son\w+\s*=\s*'[^']*'/gi, '');
    out = out.replace(/(href|xlink:href)\s*=\s*"\s*javascript:[^"]*"/gi, '$1="#"');
    out = out.replace(/(href|xlink:href)\s*=\s*'\s*javascript:[^']*'/gi, "$1='#'");
    return out;
  }

  /* ---------------- Built-in demo illustrator ---------------- */
  /* Simple flat icons in a 120 wide box, ground line at y=118. */

  function grp(name, inner) {
    return '<g data-name="' + name + '">' + inner + '</g>';
  }

  var ICONS = {
    'apple': function () {
      return '<path d="M60 34 C 50 18, 26 20, 22 44 C 18 68, 38 108, 60 104 C 82 108, 102 68, 98 44 C 94 20, 70 18, 60 34 Z" fill="#e0393e"/>' +
        '<path d="M60 32 C 60 22, 64 14, 74 10" stroke="#7a4a21" stroke-width="6" fill="none" stroke-linecap="round"/>' +
        '<path d="M62 24 C 74 8, 92 12, 94 14 C 92 28, 74 32, 62 24 Z" fill="#3f9e4d"/>' +
        '<ellipse cx="42" cy="52" rx="8" ry="14" fill="#ffffff" opacity="0.25"/>';
    },
    'balloon': function () {
      return '<path d="M60 6 C 82 6, 94 24, 94 42 C 94 64, 76 78, 60 78 C 44 78, 26 64, 26 42 C 26 24, 38 6, 60 6 Z" fill="#7c5cd6"/>' +
        '<ellipse cx="44" cy="30" rx="8" ry="14" fill="#ffffff" opacity="0.3"/>' +
        '<path d="M55 78 L65 78 L60 88 Z" fill="#5b3fb8"/>' +
        '<path d="M60 88 C 54 96, 66 100, 60 108 C 56 112, 60 116, 60 118" stroke="#444444" stroke-width="3" fill="none"/>';
    },
    'cat': function () {
      return '<path d="M92 96 C 108 90, 112 70, 104 58" stroke="#e8912d" stroke-width="9" fill="none" stroke-linecap="round"/>' +
        '<ellipse cx="56" cy="88" rx="34" ry="24" fill="#f2a541"/>' +
        '<circle cx="34" cy="58" r="24" fill="#f2a541"/>' +
        '<path d="M16 44 L14 22 L32 34 Z" fill="#f2a541"/><path d="M50 34 L56 20 L62 40 Z" fill="#f2a541"/>' +
        '<circle cx="27" cy="56" r="3.4" fill="#333333"/><circle cx="42" cy="56" r="3.4" fill="#333333"/>' +
        '<path d="M32 66 L38 66 L35 70 Z" fill="#d64560"/>';
    },
    'duck': function () {
      return '<ellipse cx="58" cy="88" rx="38" ry="24" fill="#f7cf3f"/>' +
        '<circle cx="82" cy="56" r="19" fill="#f9d95c"/>' +
        '<path d="M98 52 L116 58 L98 66 Z" fill="#ef7d1a"/>' +
        '<circle cx="88" cy="52" r="3.2" fill="#333333"/>' +
        '<path d="M44 104 L44 114 M72 104 L72 114" stroke="#ef7d1a" stroke-width="4" stroke-linecap="round"/>';
    },
    'elephant': function () {
      return '<rect x="34" y="86" width="11" height="28" rx="4" fill="#8d99ae"/><rect x="76" y="86" width="11" height="28" rx="4" fill="#8d99ae"/>' +
        '<ellipse cx="60" cy="66" rx="36" ry="28" fill="#a8b2c1"/>' +
        '<circle cx="28" cy="58" r="21" fill="#a8b2c1"/>' +
        '<ellipse cx="38" cy="56" rx="11" ry="14" fill="#8d99ae"/>' +
        '<path d="M14 66 C 6 82, 8 98, 16 106" stroke="#a8b2c1" stroke-width="10" fill="none" stroke-linecap="round"/>' +
        '<circle cx="24" cy="52" r="3" fill="#333333"/>';
    },
    'fish': function () {
      return '<path d="M8 62 L34 40 L34 84 Z" fill="#1f8ac0"/>' +
        '<ellipse cx="64" cy="62" rx="42" ry="26" fill="#f2762e"/>' +
        '<circle cx="86" cy="56" r="4" fill="#ffffff"/><circle cx="87" cy="56" r="2.2" fill="#333333"/>' +
        '<path d="M44 46 C 52 56, 52 68, 44 78 M58 42 C 66 54, 66 70, 58 82" stroke="#d95f1e" stroke-width="4" fill="none"/>';
    },
    'grapes': function () {
      return '<path d="M60 26 C 60 16, 66 10, 74 8" stroke="#7a4a21" stroke-width="5" fill="none" stroke-linecap="round"/>' +
        '<path d="M62 22 C 76 6, 96 10, 98 12 C 94 26, 74 30, 62 22 Z" fill="#3f9e4d"/>' +
        '<g fill="#7c4dbd"><circle cx="42" cy="44" r="11"/><circle cx="62" cy="42" r="11"/><circle cx="80" cy="46" r="11"/><circle cx="50" cy="62" r="11"/><circle cx="70" cy="62" r="11"/><circle cx="60" cy="80" r="11"/><circle cx="60" cy="97" r="10"/></g>' +
        '<circle cx="38" cy="40" r="3.4" fill="#ffffff" opacity="0.35"/>';
    },
    'house': function () {
      return '<rect x="26" y="56" width="68" height="56" fill="#f4e3c1"/>' +
        '<path d="M14 58 L60 22 L106 58 Z" fill="#c94f42"/>' +
        '<rect x="52" y="82" width="16" height="30" rx="2" fill="#7a4a21"/>' +
        '<rect x="32" y="66" width="14" height="14" fill="#a8d8ea"/><rect x="76" y="66" width="14" height="14" fill="#a8d8ea"/>' +
        '<rect x="78" y="30" width="10" height="18" fill="#9c6644"/>';
    },
    'ice cream': function () {
      return '<path d="M38 62 L82 62 L60 114 Z" fill="#e0aa6e"/>' +
        '<path d="M44 76 L74 100 M76 76 L46 100" stroke="#c98d4e" stroke-width="3"/>' +
        '<circle cx="46" cy="52" r="17" fill="#f28bb4"/><circle cx="72" cy="52" r="17" fill="#fff3f8"/>' +
        '<circle cx="59" cy="38" r="15" fill="#8a5a2b"/>' +
        '<circle cx="59" cy="20" r="6" fill="#d7263d"/>';
    },
    'jellyfish': function () {
      return '<path d="M22 58 C 22 30, 40 14, 60 14 C 80 14, 98 30, 98 58 C 84 50, 74 58, 60 50 C 46 58, 36 50, 22 58 Z" fill="#f28bb4"/>' +
        '<circle cx="46" cy="38" r="5" fill="#ffffff" opacity="0.5"/>' +
        '<path d="M34 60 C 30 74, 38 82, 34 96 M52 60 C 48 76, 56 84, 52 100 M68 60 C 64 76, 72 84, 68 100 M84 60 C 80 74, 88 82, 84 96" stroke="#e56b9f" stroke-width="5" fill="none" stroke-linecap="round"/>';
    },
    'kite': function () {
      return '<path d="M60 6 L92 44 L60 96 L28 44 Z" fill="#e0393e"/>' +
        '<path d="M60 6 L92 44 L60 44 Z" fill="#f7cf3f"/><path d="M60 44 L60 96 L28 44 Z" fill="#1f8ac0" opacity="0.85"/>' +
        '<path d="M60 96 C 52 104, 68 106, 60 114" stroke="#444444" stroke-width="3" fill="none"/>' +
        '<path d="M28 44 L92 44 M60 6 L60 96" stroke="#ffffff" stroke-width="2" opacity="0.6"/>';
    },
    'lion': function () {
      return '<circle cx="60" cy="60" r="42" fill="#e07b24"/>' +
        '<g fill="#e07b24"><circle cx="60" cy="18" r="10"/><circle cx="88" cy="30" r="10"/><circle cx="100" cy="58" r="10"/><circle cx="88" cy="88" r="10"/><circle cx="60" cy="102" r="10"/><circle cx="32" cy="88" r="10"/><circle cx="20" cy="58" r="10"/><circle cx="32" cy="30" r="10"/></g>' +
        '<circle cx="60" cy="60" r="30" fill="#f7cf7d"/>' +
        '<circle cx="49" cy="55" r="3.6" fill="#333333"/><circle cx="71" cy="55" r="3.6" fill="#333333"/>' +
        '<path d="M55 66 L65 66 L60 72 Z" fill="#b3541e"/>' +
        '<path d="M60 72 C 60 79, 50 79, 48 74 M60 72 C 60 79, 70 79, 72 74" stroke="#8a5a2b" stroke-width="3" fill="none" stroke-linecap="round"/>' +
        '<circle cx="33" cy="36" r="8" fill="#f7cf7d"/><circle cx="87" cy="36" r="8" fill="#f7cf7d"/>';
    },
    'lamp': function () {
      return '<rect x="56" y="52" width="8" height="58" fill="#37474f"/>' +
        '<path d="M34 110 L86 110 L80 118 L40 118 Z" fill="#37474f"/>' +
        '<path d="M38 52 C 38 30, 48 22, 60 22 C 72 22, 82 30, 82 52 Z" fill="#37474f"/>' +
        '<circle cx="60" cy="42" r="11" fill="#ffd94d"/>' +
        '<circle cx="60" cy="42" r="19" fill="#ffd94d" opacity="0.25"/>' +
        '<path d="M60 22 L60 12" stroke="#37474f" stroke-width="5" stroke-linecap="round"/>';
    },
    'moon': function () {
      return '<path d="M78 12 C 50 20, 34 44, 38 72 C 41 96, 58 108, 76 110 C 58 116, 30 104, 22 76 C 14 46, 34 16, 64 10 C 69 9, 74 10, 78 12 Z" fill="#f7d154"/>' +
        '<circle cx="50" cy="42" r="6" fill="#e8bc3e"/><circle cx="40" cy="70" r="4.4" fill="#e8bc3e"/>' +
        '<path d="M92 26 l2.6 6.4 6.4 2.6 -6.4 2.6 -2.6 6.4 -2.6 -6.4 -6.4 -2.6 6.4 -2.6 Z" fill="#fff3b0"/>';
    },
    'nest': function () {
      return '<path d="M18 62 C 22 96, 44 112, 60 112 C 76 112, 98 96, 102 62 C 76 74, 44 74, 18 62 Z" fill="#9c6644"/>' +
        '<path d="M24 74 C 44 84, 76 84, 96 74 M28 90 C 46 98, 74 98, 92 90" stroke="#7a4a21" stroke-width="4" fill="none"/>' +
        '<ellipse cx="42" cy="56" rx="11" ry="14" fill="#a8d8ea"/><ellipse cx="62" cy="52" rx="11" ry="14" fill="#cdeffd"/><ellipse cx="80" cy="57" rx="11" ry="13" fill="#a8d8ea"/>' +
        '<path d="M14 66 L6 58 M106 66 L114 58" stroke="#7a4a21" stroke-width="4" stroke-linecap="round"/>';
    },
    'owl': function () {
      return '<ellipse cx="60" cy="66" rx="32" ry="44" fill="#8a5a2b"/>' +
        '<ellipse cx="60" cy="78" rx="20" ry="28" fill="#d9b380"/>' +
        '<path d="M32 34 L44 22 L50 38 Z" fill="#8a5a2b"/><path d="M88 34 L76 22 L70 38 Z" fill="#8a5a2b"/>' +
        '<circle cx="47" cy="52" r="11" fill="#ffffff"/><circle cx="73" cy="52" r="11" fill="#ffffff"/>' +
        '<circle cx="47" cy="53" r="5" fill="#333333"/><circle cx="73" cy="53" r="5" fill="#333333"/>' +
        '<path d="M55 62 L65 62 L60 70 Z" fill="#ef7d1a"/>' +
        '<path d="M46 112 L52 106 L58 112 M62 112 L68 106 L74 112" stroke="#ef7d1a" stroke-width="3.4" fill="none" stroke-linecap="round"/>';
    },
    'penguin': function () {
      return '<ellipse cx="60" cy="66" rx="30" ry="46" fill="#2b2d42"/>' +
        '<ellipse cx="60" cy="76" rx="19" ry="32" fill="#ffffff"/>' +
        '<ellipse cx="28" cy="70" rx="7" ry="20" fill="#2b2d42" transform="rotate(12 28 70)"/>' +
        '<ellipse cx="92" cy="70" rx="7" ry="20" fill="#2b2d42" transform="rotate(-12 92 70)"/>' +
        '<circle cx="50" cy="44" r="3.4" fill="#ffffff"/><circle cx="70" cy="44" r="3.4" fill="#ffffff"/>' +
        '<path d="M54 52 L66 52 L60 60 Z" fill="#ef7d1a"/>' +
        '<path d="M44 114 L56 114 M64 114 L76 114" stroke="#ef7d1a" stroke-width="5" stroke-linecap="round"/>';
    },
    'queen': function () {
      return '<path d="M24 84 L18 34 L44 58 L60 26 L76 58 L102 34 L96 84 Z" fill="#f2b705"/>' +
        '<rect x="24" y="84" width="72" height="12" rx="4" fill="#d99a06"/>' +
        '<circle cx="18" cy="30" r="6" fill="#f2b705"/><circle cx="60" cy="22" r="6" fill="#f2b705"/><circle cx="102" cy="30" r="6" fill="#f2b705"/>' +
        '<circle cx="38" cy="76" r="5" fill="#d7263d"/><circle cx="60" cy="80" r="5" fill="#1f8ac0"/><circle cx="82" cy="76" r="5" fill="#3f9e4d"/>';
    },
    'rocket': function () {
      return '<path d="M60 6 C 78 22, 86 48, 84 76 L36 76 C 34 48, 42 22, 60 6 Z" fill="#e8ecf1"/>' +
        '<path d="M60 6 C 70 16, 78 30, 82 48 L38 48 C 42 30, 50 16, 60 6 Z" fill="#e0393e"/>' +
        '<circle cx="60" cy="60" r="10" fill="#a8d8ea"/><circle cx="60" cy="60" r="10" fill="none" stroke="#8d99ae" stroke-width="3"/>' +
        '<path d="M36 66 C 24 78, 20 92, 22 102 L36 92 Z" fill="#e0393e"/><path d="M84 66 C 96 78, 100 92, 98 102 L84 92 Z" fill="#e0393e"/>' +
        '<path d="M52 92 C 54 104, 57 110, 60 116 C 63 110, 66 104, 68 92 Z" fill="#f2762e"/>' +
        '<path d="M56 94 C 57 101, 58 105, 60 109 C 62 105, 63 101, 64 94 Z" fill="#f7cf3f"/>';
    },
    'snake': function () {
      return '<path d="M10 96 C 30 78, 44 104, 62 88 C 78 74, 84 88, 98 70" stroke="#3f9e4d" stroke-width="13" fill="none" stroke-linecap="round"/>' +
        '<path d="M22 90 C 30 84, 36 90, 44 88 M56 92 C 64 86, 70 88, 78 82" stroke="#2f7d3c" stroke-width="5" fill="none"/>' +
        '<circle cx="102" cy="64" r="12" fill="#3f9e4d"/>' +
        '<circle cx="106" cy="60" r="2.6" fill="#ffffff"/><circle cx="106.6" cy="60" r="1.3" fill="#333333"/>' +
        '<path d="M112 68 L122 72 M112 68 L121 63" stroke="#d7263d" stroke-width="2.6" stroke-linecap="round"/>';
    },
    'tree': function () {
      return '<rect x="53" y="76" width="14" height="38" rx="4" fill="#7a4a21"/>' +
        '<path d="M60 96 L44 112 M60 92 L76 106" stroke="#7a4a21" stroke-width="6" stroke-linecap="round"/>' +
        '<circle cx="60" cy="44" r="30" fill="#3f9e4d"/><circle cx="34" cy="62" r="20" fill="#4caf57"/><circle cx="86" cy="62" r="20" fill="#359846"/>' +
        '<circle cx="46" cy="40" r="5" fill="#e0393e"/><circle cx="72" cy="52" r="5" fill="#e0393e"/><circle cx="60" cy="66" r="5" fill="#e0393e"/>';
    },
    'umbrella': function () {
      return '<path d="M8 62 C 8 30, 32 12, 60 12 C 88 12, 112 30, 112 62 C 100 52, 90 62, 78 53 C 68 62, 52 62, 42 53 C 30 62, 20 52, 8 62 Z" fill="#e0393e"/>' +
        '<path d="M60 12 C 50 30, 46 44, 44 60 M60 12 C 70 30, 74 44, 76 60" stroke="#b02830" stroke-width="3" fill="none"/>' +
        '<path d="M60 12 L60 96 C 60 108, 74 108, 74 98" stroke="#37474f" stroke-width="6" fill="none" stroke-linecap="round"/>' +
        '<path d="M54 8 C 54 2, 66 2, 66 8" stroke="#37474f" stroke-width="4" fill="none"/>';
    },
    'vase': function () {
      return '<path d="M48 44 L72 44 C 72 56, 84 64, 84 82 C 84 102, 74 114, 60 114 C 46 114, 36 102, 36 82 C 36 64, 48 56, 48 44 Z" fill="#1f8ac0"/>' +
        '<rect x="45" y="38" width="30" height="8" rx="3" fill="#16739e"/>' +
        '<path d="M52 70 C 62 76, 70 72, 80 76" stroke="#ffffff" stroke-width="4" fill="none" opacity="0.6"/>' +
        '<path d="M60 38 C 58 28, 50 22, 42 18 M60 38 C 62 26, 70 20, 78 16" stroke="#3f9e4d" stroke-width="4" fill="none"/>' +
        '<circle cx="40" cy="16" r="7" fill="#f28bb4"/><circle cx="80" cy="14" r="7" fill="#f7cf3f"/>';
    },
    'whale': function () {
      return '<path d="M14 74 C 10 50, 34 32, 62 34 C 92 36, 108 52, 106 72 C 104 94, 84 106, 58 104 C 34 102, 18 94, 14 74 Z" fill="#4a90d9"/>' +
        '<path d="M104 62 C 116 52, 118 40, 114 32 C 106 40, 100 44, 96 46 Z" fill="#357abd"/>' +
        '<path d="M20 84 C 40 94, 84 94, 102 80 C 96 96, 80 104, 58 104 C 40 104, 26 96, 20 84 Z" fill="#a8d8ea"/>' +
        '<circle cx="34" cy="62" r="3.6" fill="#173f5f"/>' +
        '<path d="M52 30 C 50 22, 54 16, 50 8 M62 30 C 62 20, 68 16, 64 6 M72 32 C 74 24, 80 20, 78 12" stroke="#4a90d9" stroke-width="4" fill="none" stroke-linecap="round"/>';
    },
    'xylophone': function () {
      return '<g><rect x="14" y="30" width="14" height="74" rx="6" fill="#e0393e"/><rect x="32" y="38" width="14" height="66" rx="6" fill="#f2762e"/><rect x="50" y="46" width="14" height="58" rx="6" fill="#f7cf3f"/><rect x="68" y="54" width="14" height="50" rx="6" fill="#3f9e4d"/><rect x="86" y="62" width="14" height="42" rx="6" fill="#1f8ac0"/></g>' +
        '<g fill="#5b3a1e"><circle cx="21" cy="46" r="2.6"/><circle cx="21" cy="88" r="2.6"/><circle cx="39" cy="54" r="2.6"/><circle cx="39" cy="88" r="2.6"/><circle cx="57" cy="60" r="2.6"/><circle cx="57" cy="88" r="2.6"/><circle cx="75" cy="66" r="2.6"/><circle cx="75" cy="88" r="2.6"/><circle cx="93" cy="72" r="2.6"/><circle cx="93" cy="92" r="2.6"/></g>' +
        '<path d="M30 104 L52 22" stroke="#7a4a21" stroke-width="4" stroke-linecap="round"/><circle cx="54" cy="18" r="7" fill="#9c6644"/>';
    },
    'yacht': function () {
      return '<path d="M60 10 L60 66" stroke="#37474f" stroke-width="4"/>' +
        '<path d="M64 16 L96 66 L64 66 Z" fill="#ffffff"/><path d="M56 26 L30 66 L56 66 Z" fill="#f4e3c1"/>' +
        '<path d="M60 10 L74 14 L60 20 Z" fill="#e0393e"/>' +
        '<path d="M16 74 L104 74 L92 98 L30 98 Z" fill="#c94f42"/>' +
        '<rect x="14" y="70" width="92" height="6" rx="3" fill="#7a4a21"/>' +
        '<circle cx="48" cy="85" r="4" fill="#ffffff"/><circle cx="62" cy="85" r="4" fill="#ffffff"/><circle cx="76" cy="85" r="4" fill="#ffffff"/>' +
        '<path d="M8 106 C 24 100, 36 110, 52 104 C 68 100, 80 110, 96 104 C 104 101, 110 104, 114 106" stroke="#1f8ac0" stroke-width="4" fill="none" stroke-linecap="round"/>';
    },
    'zebra': function () {
      return '<rect x="30" y="88" width="9" height="26" rx="4" fill="#e8ecf1"/><rect x="80" y="88" width="9" height="26" rx="4" fill="#e8ecf1"/>' +
        '<ellipse cx="58" cy="72" rx="36" ry="24" fill="#f4f6f8"/>' +
        '<path d="M86 52 C 96 40, 110 40, 112 52 C 113 62, 106 70, 96 70 L86 68 Z" fill="#f4f6f8"/>' +
        '<ellipse cx="107" cy="62" rx="7" ry="5" fill="#d8dee6"/>' +
        '<path d="M92 42 L96 30 L102 40 Z" fill="#f4f6f8"/><path d="M84 44 L84 30 L92 40 Z" fill="#f4f6f8"/>' +
        '<path d="M88 44 C 92 38, 98 36, 102 38" stroke="#333333" stroke-width="5" fill="none" stroke-linecap="round"/>' +
        '<g stroke="#333333" stroke-width="5" stroke-linecap="round"><path d="M40 52 L44 74"/><path d="M54 50 L58 76"/><path d="M68 52 L70 74"/></g>' +
        '<path d="M24 62 C 16 70, 14 82, 18 92" stroke="#333333" stroke-width="4" fill="none" stroke-linecap="round"/>' +
        '<circle cx="102" cy="54" r="2.6" fill="#333333"/>';
    }
  };

  var THEMES = {
    meadow: { sky1: '#aee3f5', sky2: '#e8f9ff', hill: '#8fd07a', hill2: '#6fb85a', ground: '#57a047', sun: '#ffd94d', night: false },
    sunset: { sky1: '#ffb36b', sky2: '#ffe9c9', hill: '#e08e5a', hill2: '#c97447', ground: '#a85f38', sun: '#ff8c42', night: false },
    coast: { sky1: '#9fd8ef', sky2: '#eafcff', hill: '#7fc8bc', hill2: '#5fb3a5', ground: '#e8d8a0', sun: '#ffd94d', night: false },
    night: { sky1: '#1d2a52', sky2: '#3a4a7d', hill: '#2c4a3e', hill2: '#234236', ground: '#1d3329', sun: '#f4f1d6', night: true }
  };

  function sceneBackdrop(themeName) {
    var t = THEMES[themeName] || THEMES.meadow;
    var s = '';
    s += '<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="' + t.sky1 + '"/><stop offset="1" stop-color="' + t.sky2 + '"/></linearGradient></defs>';
    s += '<rect width="800" height="600" fill="url(#sky)"/>';
    if (t.night) {
      s += '<g fill="#ffffff"><circle cx="90" cy="70" r="2.4"/><circle cx="220" cy="44" r="1.8"/><circle cx="360" cy="86" r="2.2"/><circle cx="520" cy="40" r="1.7"/><circle cx="660" cy="90" r="2.4"/><circle cx="740" cy="36" r="1.8"/><circle cx="450" cy="120" r="1.5"/><circle cx="150" cy="130" r="1.6"/></g>';
      s += '<circle cx="676" cy="86" r="34" fill="' + t.sun + '"/><circle cx="662" cy="76" r="7" fill="#ded9ba"/><circle cx="688" cy="96" r="5" fill="#ded9ba"/>';
    } else {
      s += '<circle cx="690" cy="84" r="38" fill="' + t.sun + '"/><circle cx="690" cy="84" r="52" fill="' + t.sun + '" opacity="0.3"/>';
      s += '<g fill="#ffffff" opacity="0.85"><ellipse cx="150" cy="90" rx="52" ry="16"/><ellipse cx="196" cy="80" rx="38" ry="13"/><ellipse cx="430" cy="60" rx="44" ry="13"/><ellipse cx="466" cy="52" rx="30" ry="10"/></g>';
    }
    s += '<path d="M0 400 C 160 340, 300 386, 460 366 C 620 346, 720 380, 800 360 L800 600 L0 600 Z" fill="' + t.hill + '"/>';
    s += '<path d="M0 452 C 180 404, 340 442, 520 424 C 650 412, 740 436, 800 424 L800 600 L0 600 Z" fill="' + t.hill2 + '"/>';
    s += '<rect y="478" width="800" height="122" fill="' + t.ground + '"/>';
    return s;
  }

  function composeScene(objectNames, themeName) {
    var n = objectNames.length;
    var parts = [sceneBackdrop(themeName)];
    var margin = 70;
    var usable = 800 - margin * 2;
    objectNames.forEach(function (name, i) {
      var cx = n === 1 ? 400 : margin + (usable * (i + 0.5)) / n;
      var scale = Math.min(1.25, Math.max(0.72, (usable / n) / 128));
      var groundY = 486 + (i % 2) * 8;
      var icon = ICONS[name] ? ICONS[name]() : '<circle cx="60" cy="70" r="34" fill="#cccccc"/>';
      parts.push('<ellipse cx="' + cx.toFixed(1) + '" cy="' + (groundY + 4) + '" rx="' + (52 * scale).toFixed(1) + '" ry="7" fill="#000000" opacity="0.14"/>');
      parts.push('<g transform="translate(' + (cx - 60 * scale).toFixed(1) + ' ' + (groundY - 118 * scale).toFixed(1) + ') scale(' + scale.toFixed(3) + ')">' + grp(name, icon) + '</g>');
    });
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600" role="img" aria-label="An ordinary picture">' +
      parts.join('') + '</svg>';
  }

  function mockHide(secret, themeName) {
    var clean = sanitizeSecret(secret);
    var names = clean.split('').map(function (letter) { return MOCK_OBJECT[letter]; });
    return {
      title: 'A quiet picture (demo)',
      objects: names,
      svg: composeScene(names, themeName || 'meadow'),
      demo: true
    };
  }

  /* The gallery example, spelled H E L L O. */
  function galleryExample() {
    var names = ['house', 'elephant', 'lion', 'lamp', 'owl'];
    return {
      title: 'The example picture',
      objects: names,
      message: 'HELLO',
      svg: composeScene(names, 'meadow')
    };
  }

  function mockReveal(svg) {
    var names = objectsFromSvg(svg);
    if (!names.length) {
      return { found: false, message: '', method: '', objects: [], confidence: 'low', notes: 'No named objects found in this picture (demo reader).' };
    }
    return {
      found: true,
      message: acrosticOf(names),
      method: 'Acrostic: first letters of the depicted objects, read left to right.',
      objects: names,
      confidence: 'high',
      notes: 'Read locally in demo mode from the picture object names. A fresh model call may read it differently.'
    };
  }

  var api = {
    API_URL: API_URL,
    DEFAULT_MODEL: DEFAULT_MODEL,
    OBJECT_IDEAS: OBJECT_IDEAS,
    MOCK_OBJECT: MOCK_OBJECT,
    sanitizeSecret: sanitizeSecret,
    acrosticOf: acrosticOf,
    verifyAcrostic: verifyAcrostic,
    buildHideMessages: buildHideMessages,
    buildHideRetryMessage: buildHideRetryMessage,
    buildRevealMessages: buildRevealMessages,
    extractJson: extractJson,
    extractSvg: extractSvg,
    objectsFromSvg: objectsFromSvg,
    isBalanceNotice: isBalanceNotice,
    parseHideResponse: parseHideResponse,
    parseRevealResponse: parseRevealResponse,
    sanitizeSvg: sanitizeSvg,
    composeScene: composeScene,
    mockHide: mockHide,
    mockReveal: mockReveal,
    galleryExample: galleryExample,
    ICONS: ICONS
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.HIPS = api;
})(typeof window !== 'undefined' ? window : globalThis);
