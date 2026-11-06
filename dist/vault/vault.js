import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { realFs } from './fs.js';
import { deriveKey, encrypt, decrypt } from './crypto.js';
import { buildAad, serializeVault, parseVault, parseGeneration } from './format.js';
import { VaultConflictError, VaultLockedError, VaultIoError, VaultError, WrongPassphraseError, VaultFormatError, } from './errors.js';
const DEFAULT_KDF = Object.freeze({ m: 65536, t: 3, p: 4 });
const MAX_GENERATION = 0xffffffffffffffffn;
export class Vault {
    _path;
    _fs;
    _key = null;
    _credentials = null;
    _tokens = [];
    _projects = [];
    _generation = 0n;
    _vaultId = null;
    _kdfParams = null;
    _salt = null;
    _closed = false;
    constructor(path, fs) { this._path = path; this._fs = fs; }
    static async create(path, passphrase) {
        const vault = new Vault(path, realFs);
        await vault._withLock(async () => {
            try {
                await realFs.readFile(path);
                throw new VaultIoError('vault already exists');
            }
            catch (error) {
                if (error instanceof VaultIoError)
                    throw error;
                if (error.code !== 'ENOENT')
                    throw error;
            }
            const salt = randomBytes(16);
            const vaultId = randomBytes(16);
            const key = await deriveKey(Buffer.from(passphrase, 'utf8'), salt, DEFAULT_KDF);
            vault._key = key;
            vault._salt = salt;
            vault._vaultId = vaultId;
            vault._generation = 0n;
            vault._credentials = {};
            vault._tokens = [];
            vault._projects = [];
            vault._kdfParams = { algorithm: 'argon2id', ...DEFAULT_KDF };
            try {
                await vault._writeSnapshot({}, [], [], 0n);
            }
            catch (error) {
                key.fill(0);
                vault._key = null;
                throw error;
            }
        });
        return vault;
    }
    static async open(path, passphrase, fs = realFs) {
        const vault = new Vault(path, fs);
        let key = null;
        try {
            const data = parseVault(await fs.readFile(path));
            const salt = Buffer.from(data.kdf.salt, 'base64');
            key = await deriveKey(Buffer.from(passphrase, 'utf8'), salt, data.kdf);
            const vaultId = Buffer.from(data.vaultId, 'base64');
            const generation = parseGeneration(data.generation);
            const aad = buildAad({ version: data.version, vaultId, generation, kdf: { ...data.kdf, salt } });
            const plaintext = decrypt(key, Buffer.from(data.payload.nonce, 'base64'), Buffer.from(data.payload.ciphertext, 'base64'), Buffer.from(data.payload.tag, 'base64'), aad);
            let payload;
            try {
                payload = JSON.parse(plaintext.toString('utf8'));
            }
            catch {
                throw new WrongPassphraseError('vault cannot be opened');
            }
            finally {
                plaintext.fill(0);
            }
            if (!payload || typeof payload !== 'object' || Array.isArray(payload))
                throw new WrongPassphraseError('vault cannot be opened');
            const value = payload;
            if (value.vaultId !== data.vaultId || !value.credentials || typeof value.credentials !== 'object' || Array.isArray(value.credentials))
                throw new WrongPassphraseError('vault cannot be opened');
            vault._key = key;
            vault._salt = salt;
            vault._vaultId = vaultId;
            vault._generation = generation;
            vault._credentials = value.credentials;
            vault._tokens = Array.isArray(value.tokens) ? value.tokens : [];
            vault._projects = Array.isArray(value.projects) ? value.projects : [];
            vault._kdfParams = { algorithm: 'argon2id', m: data.kdf.m, t: data.kdf.t, p: data.kdf.p };
            key = null;
            return vault;
        }
        catch (error) {
            key?.fill(0);
            if (error instanceof WrongPassphraseError || error instanceof VaultFormatError || error instanceof VaultIoError)
                throw error;
            if (error.code === 'ENOENT' || error instanceof Error && error.message.includes('read'))
                throw new VaultIoError('cannot read vault file');
            throw error;
        }
    }
    get generation() { this._assertOpen(); return this._generation; }
    async list() { this._assertOpen(); return Object.keys(this._credentials); }
    async add(name, provider, secret) {
        this._assertOpen();
        if (!name || !provider || typeof secret !== 'string')
            throw new VaultError('invalid credential');
        if (Object.hasOwn(this._credentials, name))
            throw new VaultError('credential already exists');
        const next = { ...this._credentials, [name]: { provider, secret } };
        await this._mutate(next, this._tokens, this._projects);
    }
    async remove(name) {
        this._assertOpen();
        if (!Object.hasOwn(this._credentials, name))
            return;
        const next = { ...this._credentials };
        delete next[name];
        await this._mutate(next, this._tokens, this._projects);
    }
    /** Store only a SHA-256 digest; the plaintext token is returned to the caller, never persisted. */
    async addToken(projectId, token, expiresAt, grants) {
        this._assertOpen();
        if (!/^[0-9a-f-]{36}$/i.test(projectId) || typeof token !== 'string' || token.length < 20)
            throw new VaultError('invalid project token');
        const expiry = Date.parse(expiresAt);
        if (!Number.isFinite(expiry) || expiry <= Date.now())
            throw new VaultError('token expiry must be in the future');
        if (!Array.isArray(grants) || grants.length < 1 || grants.length > 32)
            throw new VaultError('token requires 1–32 grants');
        for (const grant of grants) {
            if (!grant || !/^[a-z][a-z0-9_-]{0,31}$/.test(grant.alias) || !['api.openai.com', 'api.anthropic.com'].includes(grant.host) || typeof grant.enabled !== 'boolean')
                throw new VaultError('invalid grant');
            if (grant.enabled && (!Array.isArray(grant.methods) || !Array.isArray(grant.paths) || grant.methods.length === 0 || grant.paths.length === 0))
                throw new VaultError('enabled grants require methods and paths');
        }
        const digest = createHash('sha256').update(token, 'utf8').digest('hex');
        if (this._tokens.some((entry) => entry.projectId === projectId && entry.status === 'active'))
            throw new VaultError('project already has an active token');
        const tokens = [...this._tokens, { projectId, tokenHashSha256: digest, issuedAt: new Date().toISOString(), expiresAt: new Date(expiry).toISOString(), status: 'active' }];
        const projects = [...this._projects.filter((p) => p.projectId !== projectId), { projectId, grants: structuredClone(grants) }];
        await this._mutate(this._credentials, tokens, projects);
    }
    /** Validate token and, when supplied, enforce the exact alias/host/method/path grant. */
    async validateToken(token, request) {
        this._assertOpen();
        if (typeof token !== 'string' || token.length < 1 || token.length > 512)
            throw new VaultError('invalid project token');
        const supplied = createHash('sha256').update(token, 'utf8').digest();
        const stored = this._tokens.find((entry) => entry.status === 'active' && entry.tokenHashSha256.length === 64 && timingSafeEqual(Buffer.from(entry.tokenHashSha256, 'hex'), supplied));
        if (!stored || Date.parse(stored.expiresAt) <= Date.now())
            throw new VaultError('invalid or expired project token');
        const project = this._projects.find((entry) => entry.projectId === stored.projectId);
        if (!project)
            throw new VaultError('project grant not found');
        if (!request)
            return { projectId: stored.projectId, grants: structuredClone(project.grants) };
        const grant = project.grants.find((entry) => entry.alias === request.alias && entry.host === request.host && entry.enabled);
        if (!grant || request.method && !grant.methods?.includes(request.method.toUpperCase()) || request.path && !grant.paths?.some((pattern) => pathMatches(pattern, request.path)))
            throw new VaultError('request is outside the project grant');
        return { projectId: stored.projectId, grants: structuredClone(project.grants), grant: structuredClone(grant) };
    }
    async revokeToken(projectId) {
        this._assertOpen();
        const now = new Date().toISOString();
        const tokens = this._tokens.map((entry) => entry.projectId === projectId && entry.status === 'active' ? { ...entry, status: 'revoked', revokedAt: now } : entry);
        if (tokens.every((entry, index) => entry === this._tokens[index]))
            return;
        await this._mutate(this._credentials, tokens, this._projects);
    }
    async resolveCredential(projectId, alias) {
        this._assertOpen();
        const project = this._projects.find((entry) => entry.projectId === projectId);
        const grant = project?.grants.find((entry) => entry.alias === alias && entry.enabled);
        if (!grant)
            throw new VaultError('credential alias is not granted to this project');
        const credential = this._credentials[alias];
        if (!credential || credential.provider !== grant.provider)
            throw new VaultError('granted credential is unavailable');
        return { ...credential };
    }
    async close() {
        if (this._closed)
            return;
        this._closed = true;
        this._key?.fill(0);
        this._salt?.fill(0);
        this._vaultId?.fill(0);
        this._key = null;
        this._credentials = null;
        this._tokens = [];
        this._projects = [];
        this._vaultId = null;
        this._salt = null;
        this._kdfParams = null;
    }
    async _mutate(credentials, tokens, projects) {
        const generation = this._nextGeneration();
        await this._writeTransaction(credentials, tokens, projects, generation);
        this._credentials = credentials;
        this._tokens = tokens;
        this._projects = projects;
        this._generation = generation;
    }
    _nextGeneration() { if (this._generation === MAX_GENERATION)
        throw new VaultError('generation overflow'); return this._generation + 1n; }
    _assertOpen() { if (this._closed)
        throw new VaultLockedError('vault is closed'); }
    async _acquireLock() {
        const lockPath = `${this._path}.lock`;
        const lockData = JSON.stringify({ pid: process.pid, timestamp: Date.now() });
        try {
            await this._fs.writeFileExclusive(lockPath, lockData);
            return;
        }
        catch (error) {
            if (error.code !== 'EEXIST')
                throw error;
        }
        let stale = false;
        try {
            const record = JSON.parse((await this._fs.readFile(lockPath)).toString('utf8'));
            if (!Number.isSafeInteger(record.pid) || !Number.isFinite(record.timestamp))
                throw new Error('invalid lock');
            const old = Date.now() - record.timestamp > 10_000;
            if (process.platform === 'win32')
                stale = old;
            else {
                try {
                    process.kill(record.pid, 0);
                }
                catch (e) {
                    stale = e.code === 'ESRCH';
                }
            }
        }
        catch {
            stale = false;
        }
        if (!stale)
            throw new VaultConflictError('vault is locked by another process');
        await this._fs.unlink(lockPath);
        try {
            await this._fs.writeFileExclusive(lockPath, lockData);
        }
        catch (error) {
            if (error.code === 'EEXIST')
                throw new VaultConflictError('vault lock was reclaimed');
            throw error;
        }
    }
    async _withLock(fn) {
        this._assertOpen();
        const lockPath = `${this._path}.lock`;
        await this._acquireLock();
        try {
            return await fn();
        }
        finally {
            await this._fs.unlink(lockPath).catch(() => undefined);
        }
    }
    async _writeTransaction(credentials, tokens, projects, generation) {
        await this._withLock(async () => {
            let current;
            try {
                current = parseVault(await this._fs.readFile(this._path));
            }
            catch (error) {
                if (error.code === 'ENOENT')
                    throw new VaultConflictError('vault file no longer exists');
                throw error;
            }
            if (parseGeneration(current.generation) !== this._generation)
                throw new VaultConflictError('generation mismatch');
            await this._writeSnapshot(credentials, tokens, projects, generation);
        });
    }
    async _writeSnapshot(credentials, tokens, projects, generation) {
        const aad = buildAad({ version: 1, vaultId: this._vaultId, generation, kdf: { ...this._kdfParams, salt: this._salt } });
        const plaintext = Buffer.from(JSON.stringify({ vaultId: this._vaultId.toString('base64'), credentials, tokens, projects }), 'utf8');
        let payload;
        try {
            payload = encrypt(this._key, plaintext, aad);
        }
        finally {
            plaintext.fill(0);
        }
        const content = serializeVault({ magic: 'KEYLESS', version: 1, vaultId: this._vaultId.toString('base64'), generation: generation.toString(), kdf: { ...this._kdfParams, salt: this._salt.toString('base64') }, payload: { nonce: payload.nonce.toString('base64'), ciphertext: payload.ciphertext.toString('base64'), tag: payload.tag.toString('base64') } });
        const tmpPath = `${this._path}.${randomBytes(16).toString('hex')}.tmp`;
        try {
            await this._fs.writeFileTmp(tmpPath, content, 0o600);
            await this._fs.fsyncAndRename(tmpPath, this._path);
        }
        catch (error) {
            await this._fs.unlink(tmpPath).catch(() => undefined);
            throw error;
        }
    }
}
function pathMatches(pattern, path) {
    const p = pattern.split('/');
    const v = path.split('/');
    return p.length === v.length && p.every((segment, index) => segment === '*' || segment === v[index]);
}
