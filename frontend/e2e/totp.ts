import { createHmac } from 'node:crypto';

/**
 * RFC 6238 TOTP, matching what Microsoft Authenticator produces for an Entra
 * "authenticator app" method: HMAC-SHA1, 6 digits, 30-second step. Written
 * against `node:crypto` rather than pulling in otpauth/otplib — it's ~30 lines
 * and the e2e job installs with `--ignore-scripts` to keep the dependency
 * surface small.
 */
const STEP_SECONDS = 30;
const DIGITS = 6;

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/**
 * Decodes the secret as Microsoft displays it ("Can't scan image?"): base32,
 * often lowercase and space-grouped. Padding and whitespace are ignored.
 */
const base32Decode = (input: string): Buffer => {
  const clean = input.replace(/[\s=-]/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) {
      throw new Error('E2E_IDIR_TOTP_SECRET is not valid base32.');
    }
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
};

export const generateTotp = (secret: string, now: number = Date.now()): string => {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 1000 / STEP_SECONDS)));

  const hmac = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 10 ** DIGITS;
  return code.toString().padStart(DIGITS, '0');
};

/**
 * Generates a code with enough of its window left to survive being typed and
 * submitted. If the current window is about to roll over, waits for the next
 * one instead — a code that expires in flight is rejected, and Entra also
 * refuses a code that has already been used, so retrying with the same one
 * doesn't help.
 */
export const freshTotp = async (secret: string, minRemainingMs = 5_000): Promise<string> => {
  const stepMs = STEP_SECONDS * 1000;
  const remaining = stepMs - (Date.now() % stepMs);
  if (remaining < minRemainingMs) {
    await new Promise((resolve) => setTimeout(resolve, remaining + 250));
  }
  return generateTotp(secret);
};
