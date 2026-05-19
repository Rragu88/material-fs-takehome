// Filesystem-specific error hierarchy.
//
// We throw rather than returning Result<T, E> because filesystem failures
// are exceptional — a real fs API throws too. Subclassing one common base
// lets callers `catch (e)` either broadly or specifically via `instanceof`.
//
// Every concrete subclass carries the offending path string so error messages
// are useful without the caller having to inspect both error type and message.

export class FileSystemError extends Error {
  constructor(
    message: string,
    public readonly path?: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidPathError extends FileSystemError {
  constructor(path: string, reason: string) {
    super(`Invalid path "${path}": ${reason}`, path);
  }
}

export class PathNotFoundError extends FileSystemError {
  constructor(path: string) {
    super(`Path not found: "${path}"`, path);
  }
}

export class NotADirectoryError extends FileSystemError {
  constructor(path: string) {
    super(`Not a directory: "${path}"`, path);
  }
}

export class NotAFileError extends FileSystemError {
  constructor(path: string) {
    super(`Not a file: "${path}"`, path);
  }
}

export class AlreadyExistsError extends FileSystemError {
  constructor(path: string) {
    super(`Path already exists: "${path}"`, path);
  }
}

export class DirectoryNotEmptyError extends FileSystemError {
  constructor(path: string) {
    super(`Directory not empty: "${path}"`, path);
  }
}

export class InvalidOperationError extends FileSystemError {
  constructor(message: string, path?: string) {
    super(message, path);
  }
}
