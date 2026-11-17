import { InstantAnswer } from './search-types';

/**
 * Safe recursive-descent math expression evaluator (no eval / Function).
 */
function evaluateMathExpression(expr: string): number | null {
  const cleaned = expr
    .trim()
    .replace(/×/g, '*')
    .replace(/÷/g, '/')
    .replace(/−/g, '-')
    .replace(/,/g, '');

  // Must contain at least one operator or math function call so plain numbers/years aren't echoed
  const hasOperatorOrFunc =
    /[+\-*/%^()]/.test(cleaned) || /\b(sqrt|sin|cos|tan|log|ln|abs|round|floor|ceil)\s*\(/i.test(cleaned);
  if (!hasOperatorOrFunc) return null;

  // Exclude dates like 2026-11-16 or version strings like 1.2.3
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(cleaned)) return null;

  const tokens: string[] = [];
  let i = 0;
  while (i < cleaned.length) {
    const ch = cleaned[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (/[+\-*/%^()]/.test(ch)) {
      tokens.push(ch);
      i++;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      let numStr = '';
      while (i < cleaned.length && /[0-9.]/.test(cleaned[i])) {
        numStr += cleaned[i++];
      }
      if (!/^\d*\.?\d+$/.test(numStr)) return null;
      tokens.push(numStr);
      continue;
    }
    if (/[a-zA-Z]/.test(ch)) {
      let ident = '';
      while (i < cleaned.length && /[a-zA-Z]/.test(cleaned[i])) {
        ident += cleaned[i++];
      }
      tokens.push(ident.toLowerCase());
      continue;
    }
    return null;
  }

  if (tokens.length === 0) return null;
  let pos = 0;

  const peek = () => tokens[pos];
  const consume = () => tokens[pos++];

  const parseExpression = (): number => {
    let val = parseTerm();
    while (peek() === '+' || peek() === '-') {
      const op = consume();
      const rhs = parseTerm();
      val = op === '+' ? val + rhs : val - rhs;
    }
    return val;
  };

  const parseTerm = (): number => {
    let val = parsePower();
    while (peek() === '*' || peek() === '/' || peek() === '%') {
      const op = consume();
      const rhs = parsePower();
      if (op === '*') val *= rhs;
      else if (op === '/') {
        if (rhs === 0) throw new Error('Division by zero');
        val /= rhs;
      } else {
        if (rhs === 0) throw new Error('Modulo by zero');
        val %= rhs;
      }
    }
    return val;
  };

  const parsePower = (): number => {
    const base = parseUnary();
    if (peek() === '^') {
      consume();
      const exp = parsePower();
      return Math.pow(base, exp);
    }
    return base;
  };

  const parseUnary = (): number => {
    if (peek() === '-') {
      consume();
      return -parseUnary();
    }
    if (peek() === '+') {
      consume();
      return parseUnary();
    }
    return parsePrimary();
  };

  const parsePrimary = (): number => {
    const tok = peek();
    if (!tok) throw new Error('Unexpected end');

    if (tok === '(') {
      consume();
      const inner = parseExpression();
      if (consume() !== ')') throw new Error('Missing )');
      return inner;
    }

    if (/^\d*\.?\d+$/.test(tok)) {
      consume();
      return Number(tok);
    }

    if (tok === 'pi') {
      consume();
      return Math.PI;
    }
    if (tok === 'e') {
      consume();
      return Math.E;
    }

    const mathFuncs: Record<string, (n: number) => number> = {
      sqrt: Math.sqrt,
      abs: Math.abs,
      sin: Math.sin,
      cos: Math.cos,
      tan: Math.tan,
      log: Math.log10,
      ln: Math.log,
      round: Math.round,
      floor: Math.floor,
      ceil: Math.ceil,
    };

    if (mathFuncs[tok]) {
      consume();
      if (consume() !== '(') throw new Error('Expected (');
      const arg = parseExpression();
      if (consume() !== ')') throw new Error('Expected )');
      return mathFuncs[tok](arg);
    }

    throw new Error(`Unknown token: ${tok}`);
  };

  try {
    const result = parseExpression();
    if (pos !== tokens.length || !Number.isFinite(result)) return null;
    return result;
  } catch {
    return null;
  }
}

function formatNumber(n: number): string {
  if (Math.abs(n - Math.round(n)) < 1e-9) return String(Math.round(n));
  return Number(n.toFixed(6)).toString();
}

const LINEAR_UNITS: Record<string, { group: string; toBase: number; label: string }> = {
  // Distance (base: meter)
  m: { group: 'length', toBase: 1, label: 'm' },
  meter: { group: 'length', toBase: 1, label: 'm' },
  meters: { group: 'length', toBase: 1, label: 'm' },
  metro: { group: 'length', toBase: 1, label: 'm' },
  metros: { group: 'length', toBase: 1, label: 'm' },
  km: { group: 'length', toBase: 1000, label: 'km' },
  kilometer: { group: 'length', toBase: 1000, label: 'km' },
  kilometers: { group: 'length', toBase: 1000, label: 'km' },
  cm: { group: 'length', toBase: 0.01, label: 'cm' },
  mm: { group: 'length', toBase: 0.001, label: 'mm' },
  mi: { group: 'length', toBase: 1609.344, label: 'miles' },
  mile: { group: 'length', toBase: 1609.344, label: 'miles' },
  miles: { group: 'length', toBase: 1609.344, label: 'miles' },
  milhas: { group: 'length', toBase: 1609.344, label: 'miles' },
  ft: { group: 'length', toBase: 0.3048, label: 'ft' },
  foot: { group: 'length', toBase: 0.3048, label: 'ft' },
  feet: { group: 'length', toBase: 0.3048, label: 'ft' },
  in: { group: 'length', toBase: 0.0254, label: 'in' },
  inch: { group: 'length', toBase: 0.0254, label: 'in' },
  inches: { group: 'length', toBase: 0.0254, label: 'in' },
  yd: { group: 'length', toBase: 0.9144, label: 'yd' },

  // Mass (base: gram)
  g: { group: 'mass', toBase: 1, label: 'g' },
  gram: { group: 'mass', toBase: 1, label: 'g' },
  grams: { group: 'mass', toBase: 1, label: 'g' },
  kg: { group: 'mass', toBase: 1000, label: 'kg' },
  kilo: { group: 'mass', toBase: 1000, label: 'kg' },
  kilos: { group: 'mass', toBase: 1000, label: 'kg' },
  lb: { group: 'mass', toBase: 453.59237, label: 'lb' },
  lbs: { group: 'mass', toBase: 453.59237, label: 'lb' },
  pound: { group: 'mass', toBase: 453.59237, label: 'lb' },
  pounds: { group: 'mass', toBase: 453.59237, label: 'lb' },
  oz: { group: 'mass', toBase: 28.349523125, label: 'oz' },
  ounce: { group: 'mass', toBase: 28.349523125, label: 'oz' },
  ounces: { group: 'mass', toBase: 28.349523125, label: 'oz' },

  // Digital Storage (base: byte, decimal 1024 for practical IT sizing)
  b: { group: 'data', toBase: 1, label: 'B' },
  bytes: { group: 'data', toBase: 1, label: 'B' },
  kb: { group: 'data', toBase: 1024, label: 'KB' },
  mb: { group: 'data', toBase: 1024 ** 2, label: 'MB' },
  gb: { group: 'data', toBase: 1024 ** 3, label: 'GB' },
  tb: { group: 'data', toBase: 1024 ** 4, label: 'TB' },
};

function evaluateUnitConversion(q: string): InstantAnswer | null {
  const m = q
    .trim()
    .match(/^(-?\d+(?:\.\d+)?)\s*°?([a-zA-Z]+)\s+(?:to|in|em|para)\s+°?([a-zA-Z]+)$/i);
  if (!m) return null;

  const value = Number(m[1]);
  const fromUnit = m[2].toLowerCase();
  const toUnit = m[3].toLowerCase();
  if (!Number.isFinite(value)) return null;

  const tempNorm = (u: string): 'c' | 'f' | 'k' | null => {
    if (['c', 'celsius', 'centigrade'].includes(u)) return 'c';
    if (['f', 'fahrenheit'].includes(u)) return 'f';
    if (['k', 'kelvin'].includes(u)) return 'k';
    return null;
  };

  const tFrom = tempNorm(fromUnit);
  const tTo = tempNorm(toUnit);
  if (tFrom && tTo) {
    const celsius = tFrom === 'c' ? value : tFrom === 'f' ? ((value - 32) * 5) / 9 : value - 273.15;
    const out = tTo === 'c' ? celsius : tTo === 'f' ? (celsius * 9) / 5 + 32 : celsius + 273.15;
    return {
      source: 'Unit Converter',
      kind: 'converter',
      heading: `${value}°${tFrom.toUpperCase()} = ${formatNumber(out)}°${tTo.toUpperCase()}`,
      text: `${formatNumber(out)}°${tTo.toUpperCase()}`,
      detail: `${value}°${tFrom.toUpperCase()} converted to °${tTo.toUpperCase()}`,
    };
  }

  const uFrom = LINEAR_UNITS[fromUnit];
  const uTo = LINEAR_UNITS[toUnit];
  if (uFrom && uTo && uFrom.group === uTo.group) {
    const converted = (value * uFrom.toBase) / uTo.toBase;
    return {
      source: 'Unit Converter',
      kind: 'converter',
      heading: `${value} ${uFrom.label} = ${formatNumber(converted)} ${uTo.label}`,
      text: `${formatNumber(converted)} ${uTo.label}`,
      detail: `${value} ${uFrom.label} in ${uTo.label}`,
    };
  }

  return null;
}

const CITY_TIMEZONES: Record<string, { tz: string; label: string }> = {
  lisbon: { tz: 'Europe/Lisbon', label: 'Lisbon, PT' },
  lisboa: { tz: 'Europe/Lisbon', label: 'Lisboa, PT' },
  porto: { tz: 'Europe/Lisbon', label: 'Porto, PT' },
  portugal: { tz: 'Europe/Lisbon', label: 'Lisbon, PT' },
  london: { tz: 'Europe/London', label: 'London, UK' },
  paris: { tz: 'Europe/Paris', label: 'Paris, FR' },
  madrid: { tz: 'Europe/Madrid', label: 'Madrid, ES' },
  berlin: { tz: 'Europe/Berlin', label: 'Berlin, DE' },
  rome: { tz: 'Europe/Rome', label: 'Rome, IT' },
  tokyo: { tz: 'Asia/Tokyo', label: 'Tokyo, JP' },
  'new york': { tz: 'America/New_York', label: 'New York, US' },
  nyc: { tz: 'America/New_York', label: 'New York, US' },
  'san francisco': { tz: 'America/Los_Angeles', label: 'San Francisco, US' },
  'los angeles': { tz: 'America/Los_Angeles', label: 'Los Angeles, US' },
  'sao paulo': { tz: 'America/Sao_Paulo', label: 'São Paulo, BR' },
  'são paulo': { tz: 'America/Sao_Paulo', label: 'São Paulo, BR' },
  brasil: { tz: 'America/Sao_Paulo', label: 'Brasília / São Paulo, BR' },
  sydney: { tz: 'Australia/Sydney', label: 'Sydney, AU' },
  dubai: { tz: 'Asia/Dubai', label: 'Dubai, AE' },
  utc: { tz: 'UTC', label: 'UTC' },
  gmt: { tz: 'UTC', label: 'GMT / UTC' },
};

function evaluateTimezoneQuery(q: string, now: Date): InstantAnswer | null {
  const m = q
    .trim()
    .match(/^(?:current\s+)?(?:time|horas?)\s+(?:in|em|at|no|na)\s+(.+)$/i);
  if (!m) return null;

  const cityKey = m[1].trim().toLowerCase().replace(/[?.!]+$/, '');
  const entry = CITY_TIMEZONES[cityKey];
  if (!entry) return null;

  try {
    const formattedTime = new Intl.DateTimeFormat('en-GB', {
      timeZone: entry.tz,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(now);
    const formattedDate = new Intl.DateTimeFormat('en-GB', {
      timeZone: entry.tz,
      weekday: 'long',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    }).format(now);

    return {
      source: 'World Clock',
      kind: 'timezone',
      heading: `${entry.label} (${entry.tz})`,
      text: `${formattedTime} · ${formattedDate}`,
      detail: `Local time in ${entry.label}`,
    };
  } catch {
    return null;
  }
}

function evaluateColorUtility(q: string): InstantAnswer | null {
  const hexMatch = q.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!hexMatch) return null;

  let hex = hexMatch[1].toLowerCase();
  if (hex.length === 3) {
    hex = hex
      .split('')
      .map((c) => c + c)
      .join('');
  }
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);

  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rn:
        h = (gn - bn) / d + (gn < bn ? 6 : 0);
        break;
      case gn:
        h = (bn - rn) / d + 2;
        break;
      default:
        h = (rn - gn) / d + 4;
        break;
    }
    h /= 6;
  }

  const normalizedHex = `#${hex.toUpperCase()}`;
  return {
    source: 'Color Inspector',
    kind: 'color',
    heading: normalizedHex,
    text: `rgb(${r}, ${g}, ${b}) · hsl(${Math.round(h * 360)}°, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%)`,
    detail: normalizedHex,
  };
}

function evaluateDeveloperUtility(q: string): InstantAnswer | null {
  const trimmed = q.trim();
  const b64Encode = trimmed.match(/^base64\s+encode\s+(.+)$/i);
  if (b64Encode) {
    const encoded = Buffer.from(b64Encode[1], 'utf8').toString('base64');
    return {
      source: 'Developer Utility',
      kind: 'developer',
      heading: 'Base64 Encoded',
      text: encoded,
      detail: `Input: ${b64Encode[1]}`,
    };
  }

  const b64Decode = trimmed.match(/^base64\s+decode\s+([A-Za-z0-9+/=]+)$/i);
  if (b64Decode) {
    const decoded = Buffer.from(b64Decode[1], 'base64').toString('utf8');
    return {
      source: 'Developer Utility',
      kind: 'developer',
      heading: 'Base64 Decoded',
      text: decoded,
      detail: `Base64: ${b64Decode[1]}`,
    };
  }

  if (/^(?:uuid|generate uuid|random uuid)$/i.test(trimmed)) {
    const id =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
            const r = (Math.random() * 16) | 0;
            const v = c === 'x' ? r : (r & 0x3) | 0x8;
            return v.toString(16);
          });
    return {
      source: 'Developer Utility',
      kind: 'developer',
      heading: 'UUID v4',
      text: id,
      detail: 'Generated locally with zero upstream calls',
    };
  }

  return null;
}

/**
 * Evaluates zero-hop deterministic utilities directly in milliseconds:
 * math calculator, unit converter, world clock, hex color inspector, and developer utilities.
 */
export function evaluateInstantUtility(
  rawQuery: string,
  now: Date = new Date()
): InstantAnswer | null {
  const q = rawQuery.trim();
  if (!q) return null;

  const dev = evaluateDeveloperUtility(q);
  if (dev) return dev;

  const color = evaluateColorUtility(q);
  if (color) return color;

  const tz = evaluateTimezoneQuery(q, now);
  if (tz) return tz;

  const unit = evaluateUnitConversion(q);
  if (unit) return unit;

  const mathExpr = q.replace(/^=\s*/, '').replace(/\s*=$/, '');
  const mathVal = evaluateMathExpression(mathExpr);
  if (mathVal !== null) {
    return {
      source: 'Instant Calculator',
      kind: 'calculator',
      heading: mathExpr,
      text: formatNumber(mathVal),
      detail: `${mathExpr} = ${formatNumber(mathVal)}`,
    };
  }

  return null;
}
