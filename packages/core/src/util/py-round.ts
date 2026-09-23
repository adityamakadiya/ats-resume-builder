/**
 * Python's `round()`, exactly.
 *
 * Both languages use IEEE 754 doubles, so the arithmetic matches. Rounding
 * does not:
 *
 * * `Math.round()` rounds half **away from zero** on the *approximated* value.
 * * `Number.prototype.toFixed()` rounds half away from zero on the *exact*
 *   value of the double ("if there are two such n, pick the larger n").
 * * Python's `round(x, n)` rounds half **to even** on the exact value of the
 *   double, via David Gay's correctly-rounded conversion.
 *
 * So `round(2.5)` is `2` in Python and `3` in JS, and `round(0.25, 1)` is
 * `0.2` in Python and `"0.3"` from `toFixed(1)`.
 *
 * Ties are rarer than they look, because most decimals are not exactly
 * representable: for one decimal place a tie requires `x * 10` to be exactly a
 * half-integer, i.e. `x = (2k+1)/20`, which is only a double when the fraction
 * reduces to a power-of-two denominator — `n + 0.25` and `n + 0.75`. Those turn
 * up constantly in a weighted score built from quarters, which is exactly why
 * this helper is not optional.
 *
 * Implementation: recover the double's exact value as `mantissa * 2^exponent`
 * with BigInt, do the division in exact integer arithmetic, and break the tie
 * to even. No floating point is involved until the final conversion back, which
 * is a correctly-rounded integer division and therefore matches what Python
 * hands back.
 */

const SCRATCH = new DataView(new ArrayBuffer(8));

export function pyRound(x: number, ndigits = 0): number {
  if (!Number.isFinite(x) || x === 0) return x;

  const negative = x < 0;
  const magnitude = Math.abs(x);

  SCRATCH.setFloat64(0, magnitude);
  const hi = SCRATCH.getUint32(0);
  const lo = SCRATCH.getUint32(4);
  const rawExponent = (hi >>> 20) & 0x7ff;

  let mantissa = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let exponent: number;
  if (rawExponent === 0) {
    exponent = -1074; // subnormal
  } else {
    mantissa |= 1n << 52n;
    exponent = rawExponent - 1075;
  }

  // magnitude === mantissa * 2^exponent, exactly.
  let numerator = mantissa;
  let denominator = 1n;
  if (ndigits >= 0) numerator *= 10n ** BigInt(ndigits);
  else denominator *= 10n ** BigInt(-ndigits);
  if (exponent >= 0) numerator <<= BigInt(exponent);
  else denominator <<= BigInt(-exponent);

  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  const doubled = remainder * 2n;

  let rounded = quotient;
  if (doubled > denominator || (doubled === denominator && (quotient & 1n) === 1n)) {
    rounded = quotient + 1n;
  }

  const scaled = Number(rounded);
  const result = ndigits >= 0 ? scaled / 10 ** ndigits : scaled * 10 ** -ndigits;
  return negative ? -result : result;
}
