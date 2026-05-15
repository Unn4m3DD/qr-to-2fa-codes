export type OtpType = "totp" | "hotp";

export type OtpAuthData = {
  type: OtpType;
  label: string;
  issuer: string;
  account: string;
  secret: string;
  algorithm: "SHA1" | "SHA256" | "SHA512";
  digits: number;
  period: number;
  counter?: number;
  uri: string;
};

const SUPPORTED_ALGORITHMS = new Set(["SHA1", "SHA256", "SHA512"]);
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function parseOtpAuthUri(input: string): OtpAuthData {
  const uri = input.trim();

  if (!uri) {
    throw new Error("Paste an otpauth URI or paste/upload a QR code image.");
  }

  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    throw new Error("That is not a valid otpauth URI.");
  }

  if (url.protocol !== "otpauth:") {
    throw new Error("The QR code did not contain an otpauth URI.");
  }

  const type = url.hostname.toLowerCase();
  if (type !== "totp" && type !== "hotp") {
    throw new Error(`Unsupported OTP type "${type}".`);
  }

  const rawLabel = decodeURIComponent(url.pathname.replace(/^\//, ""));
  const { issuerFromLabel, account } = splitLabel(rawLabel);
  const issuer = url.searchParams.get("issuer")?.trim() || issuerFromLabel;
  const secret = normalizeSecret(url.searchParams.get("secret") || "");

  if (!secret) {
    throw new Error("The otpauth URI does not contain a secret.");
  }

  const algorithm = (url.searchParams.get("algorithm") || "SHA1")
    .replace("-", "")
    .toUpperCase();

  if (!SUPPORTED_ALGORITHMS.has(algorithm)) {
    throw new Error(`Unsupported algorithm "${algorithm}".`);
  }

  const digits = parseIntegerParam("digits", url.searchParams.get("digits"), 6, 1, 10);
  const period = parseIntegerParam("period", url.searchParams.get("period"), 30, 1, 3600);
  const counterParam = url.searchParams.get("counter");
  const counter =
    counterParam === null ? undefined : parseIntegerParam("counter", counterParam, 0, 0);

  return {
    type,
    label: rawLabel,
    issuer,
    account,
    secret,
    algorithm: algorithm as OtpAuthData["algorithm"],
    digits,
    period,
    counter,
    uri,
  };
}

export async function generateTotp(
  secret: string,
  options: Pick<OtpAuthData, "algorithm" | "digits" | "period">,
  at = Date.now(),
  stepOffset = 0,
) {
  const counter = Math.floor(at / 1000 / options.period) + stepOffset;
  return generateHotp(secret, options.algorithm, options.digits, counter);
}

export function secondsRemaining(period: number, at = Date.now()) {
  const elapsed = Math.floor(at / 1000) % period;
  return period - elapsed;
}

async function generateHotp(
  secret: string,
  algorithm: OtpAuthData["algorithm"],
  digits: number,
  counter: number,
) {
  const keyData = decodeBase32(secret);
  const counterBuffer = new ArrayBuffer(8);
  const view = new DataView(counterBuffer);
  const high = Math.floor(counter / 0x100000000);
  const low = counter >>> 0;
  view.setUint32(0, high, false);
  view.setUint32(4, low, false);

  const key = await crypto.subtle.importKey(
    "raw",
    keyData,
    {
      name: "HMAC",
      hash: hashName(algorithm),
    },
    false,
    ["sign"],
  );

  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, counterBuffer));
  const offset = signature[signature.length - 1] & 0x0f;
  const binary =
    ((signature[offset] & 0x7f) << 24) |
    ((signature[offset + 1] & 0xff) << 16) |
    ((signature[offset + 2] & 0xff) << 8) |
    (signature[offset + 3] & 0xff);
  const modulo = 10 ** digits;

  return String(binary % modulo).padStart(digits, "0");
}

function decodeBase32(secret: string) {
  const normalized = normalizeSecret(secret).replace(/=+$/g, "");
  let bits = "";
  const bytes: number[] = [];

  for (const char of normalized) {
    const value = BASE32_ALPHABET.indexOf(char);
    if (value === -1) {
      throw new Error("The secret contains characters outside Base32.");
    }
    bits += value.toString(2).padStart(5, "0");
  }

  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  }

  return new Uint8Array(bytes);
}

function normalizeSecret(secret: string) {
  return secret.replace(/[\s-]/g, "").toUpperCase();
}

function splitLabel(label: string) {
  const [maybeIssuer, ...rest] = label.split(":");
  if (rest.length === 0) {
    return {
      issuerFromLabel: "",
      account: label,
    };
  }

  return {
    issuerFromLabel: maybeIssuer.trim(),
    account: rest.join(":").trim(),
  };
}

function parseIntegerParam(
  name: string,
  value: string | null,
  fallback: number,
  min: number,
  max = Number.MAX_SAFE_INTEGER,
) {
  if (value === null || value.trim() === "") {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`Invalid ${name} value "${value}".`);
  }

  return parsed;
}

function hashName(algorithm: OtpAuthData["algorithm"]) {
  switch (algorithm) {
    case "SHA256":
      return "SHA-256";
    case "SHA512":
      return "SHA-512";
    case "SHA1":
    default:
      return "SHA-1";
  }
}
