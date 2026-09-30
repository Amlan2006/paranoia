import { generateMnemonic, mnemonicToAccount, english } from "viem/accounts";
import { validateMnemonic } from "@scure/bip39";
import type { Address } from "viem";

const ITERATIONS = 600_000;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export type EncryptedVault = {
  version: 1;
  owner: Address;
  salt: number[];
  iv: number[];
  ciphertext: number[];
  iterations: number;
};

export function newMnemonic(): string {
  return generateMnemonic(english, 128);
}

export function normalizeMnemonic(value: string): string {
  const mnemonic = value.trim().toLowerCase().replace(/\s+/g, " ");
  if (!validateMnemonic(mnemonic, english)) throw new Error("Invalid recovery phrase.");
  return mnemonic;
}

export function ownerFromMnemonic(mnemonic: string): Address {
  return mnemonicToAccount(normalizeMnemonic(mnemonic)).address;
}

async function deriveKey(password: string, salt: Uint8Array, iterations: number) {
  const input = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations },
    input,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptMnemonic(mnemonicInput: string, password: string): Promise<EncryptedVault> {
  if (password.length < 12) throw new Error("Use a password of at least 12 characters.");
  const mnemonic = normalizeMnemonic(mnemonicInput);
  const salt = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, ITERATIONS);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(mnemonic));
  return {
    version: 1,
    owner: ownerFromMnemonic(mnemonic),
    salt: [...salt],
    iv: [...iv],
    ciphertext: [...new Uint8Array(ciphertext)],
    iterations: ITERATIONS,
  };
}

export async function decryptMnemonic(vault: EncryptedVault, password: string): Promise<string> {
  if (vault.version !== 1 || vault.iterations !== ITERATIONS || vault.salt.length !== 32 || vault.iv.length !== 12) {
    throw new Error("Unsupported or damaged wallet vault.");
  }
  try {
    const key = await deriveKey(password, new Uint8Array(vault.salt), vault.iterations);
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: new Uint8Array(vault.iv) },
      key,
      new Uint8Array(vault.ciphertext),
    );
    const mnemonic = normalizeMnemonic(decoder.decode(plaintext));
    if (ownerFromMnemonic(mnemonic).toLowerCase() !== vault.owner.toLowerCase()) throw new Error();
    return mnemonic;
  } catch {
    throw new Error("Wrong password or damaged wallet vault.");
  }
}
