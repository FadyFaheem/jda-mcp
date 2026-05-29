import type { MocaCell } from "./types.js";

/**
 * Convert a raw MOCA field value to a JS value using the MOCA field type codes:
 *   D=datetime, F/X=double, I/P=int, L=long, O=boolean, V=binary(base64),
 *   R=results(nested), S/T/Z/G/J=string/object, ?=unknown.
 */
export function coerceMocaValue(typeCode: string, raw: string, isNull: boolean): MocaCell {
  const t = (typeCode || "").toUpperCase();
  if (isNull) {
    return t === "F" || t === "X" || t === "I" || t === "P" || t === "L" ? 0 : null;
  }
  const value = raw ?? "";
  switch (t) {
    case "I":
    case "P": {
      const n = parseInt(value, 10);
      return Number.isNaN(n) ? value : n;
    }
    case "L": {
      if (/^-?\d+$/.test(value)) {
        const n = Number(value);
        return Number.isSafeInteger(n) ? n : value;
      }
      return value;
    }
    case "F":
    case "X": {
      if (value.trim() === "") return 0;
      let cleaned = value;
      if (/^-?\d+\.0$/.test(cleaned)) cleaned = cleaned.slice(0, -2);
      if (/^-?\d+$/.test(cleaned)) return parseInt(cleaned, 10);
      const f = parseFloat(cleaned);
      return Number.isNaN(f) ? value : f;
    }
    case "O":
      return value === "1" || value.toLowerCase() === "true";
    case "D": {
      const m = /^(\d{14}|\d{8})$/.exec(value);
      if (!m) return value;
      const y = value.slice(0, 4);
      const mo = value.slice(4, 6);
      const d = value.slice(6, 8);
      if (value.length === 14) {
        return `${y}-${mo}-${d} ${value.slice(8, 10)}:${value.slice(10, 12)}:${value.slice(12, 14)}`;
      }
      return `${y}-${mo}-${d}`;
    }
    default:
      return value;
  }
}
