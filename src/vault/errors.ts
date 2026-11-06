export class VaultError extends Error {
  constructor(message = 'vault operation failed') { super(message); this.name = 'VaultError'; }
}
export class VaultFormatError extends VaultError {
  constructor(message = 'invalid vault format') { super(message); this.name = 'VaultFormatError'; }
}
export class VaultVersionError extends VaultError {
  constructor(version: number) { super(`This vault uses a newer version (${version}). Upgrade Keyless to open it.`); this.name = 'VaultVersionError'; }
}
export class WrongPassphraseError extends VaultError {
  constructor(message = 'vault cannot be opened') { super(message); this.name = 'WrongPassphraseError'; }
}
export class VaultIoError extends VaultError {
  constructor(message = 'vault I/O failed') { super(message); this.name = 'VaultIoError'; }
}
export class VaultConflictError extends VaultError {
  constructor(message = 'vault generation conflict') { super(message); this.name = 'VaultConflictError'; }
}
export class VaultLockedError extends VaultError {
  constructor(message = 'vault is locked') { super(message); this.name = 'VaultLockedError'; }
}
export class KdfParamsError extends VaultFormatError {
  constructor(message = 'invalid KDF parameters') { super(message); this.name = 'KdfParamsError'; }
}
