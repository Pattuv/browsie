import { createHash, randomBytes } from 'node:crypto';

// PKCE (RFC 7636): the verifier stays in main's memory; only its SHA-256 "fingerprint"
// (the challenge) goes out in the browser URL. Google later demands the verifier itself,
// so a stolen code is useless to anyone who can't produce it.
export const createPkcePair = () => {
  const verifier = randomBytes(64).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
};

// Echoed back by Google on the redirect; lets the loopback server reject callbacks we didn't start.
export const createState = () => randomBytes(32).toString('base64url');
