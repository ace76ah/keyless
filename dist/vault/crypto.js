import { randomBytes } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { xchacha20poly1305 } from '@noble/ciphers/chacha';
import { KDF_LIMITS } from './format.js';
import { KdfParamsError, WrongPassphraseError } from './errors.js';
export async function deriveKey(passphrase, salt, params) {
    if (!Number.isSafeInteger(params.m) || params.m < KDF_LIMITS.minMemoryKiB || params.m > KDF_LIMITS.maxMemoryKiB ||
        !Number.isSafeInteger(params.t) || params.t < KDF_LIMITS.minIterations || params.t > KDF_LIMITS.maxIterations ||
        !Number.isSafeInteger(params.p) || params.p < KDF_LIMITS.minParallelism || params.p > KDF_LIMITS.maxParallelism ||
        params.m < 8 * params.p || salt.length !== 16) {
        throw new KdfParamsError('KDF parameters are outside the permitted range.');
    }
    const passphraseCopy = Buffer.from(passphrase);
    const saltCopy = Buffer.from(salt);
    return new Promise((resolve, reject) => {
        const worker = new Worker(new URL('./kdf-worker.js', import.meta.url), {
            workerData: { passphrase: passphraseCopy, salt: saltCopy, params },
        });
        let settled = false;
        worker.once('message', (value) => {
            settled = true;
            resolve(Buffer.from(value));
            passphraseCopy.fill(0);
            saltCopy.fill(0);
        });
        worker.once('error', (error) => {
            if (!settled) {
                settled = true;
                reject(error);
            }
            passphraseCopy.fill(0);
            saltCopy.fill(0);
        });
        worker.once('exit', (code) => {
            if (!settled && code !== 0) {
                settled = true;
                reject(new Error(`KDF worker stopped with exit code ${code}`));
            }
            passphraseCopy.fill(0);
            saltCopy.fill(0);
        });
    });
}
export function encrypt(key, plaintext, aad) {
    const nonce = randomBytes(24);
    const combined = xchacha20poly1305(key, nonce, aad).encrypt(plaintext);
    return {
        nonce,
        ciphertext: Buffer.from(combined.subarray(0, -16)),
        tag: Buffer.from(combined.subarray(-16)),
    };
}
export function decrypt(key, nonce, ciphertext, tag, aad) {
    try {
        return Buffer.from(xchacha20poly1305(key, nonce, aad).decrypt(Buffer.concat([ciphertext, tag])));
    }
    catch {
        throw new WrongPassphraseError('vault cannot be opened');
    }
}
