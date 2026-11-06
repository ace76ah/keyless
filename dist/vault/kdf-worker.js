import { parentPort, workerData } from 'node:worker_threads';
import { argon2id } from '@noble/hashes/argon2';
const { passphrase, salt, params } = workerData;
const key = argon2id(Buffer.from(passphrase), Buffer.from(salt), {
    m: params.m, t: params.t, p: params.p, dkLen: 32,
});
parentPort?.postMessage(Buffer.from(key));
key.fill(0);
