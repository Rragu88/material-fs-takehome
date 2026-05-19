// Immutable path value object.
//
// Encapsulates parsing, normalization, and arithmetic on filesystem paths.
// The filesystem layer should never split/join path strings directly — it
// goes through this class so all the edge cases (empty segments, ".",
// "..", trailing slashes, "..-past-root") have a single canonical answer.
//
// Design choices:
//   - Immutable: every operation returns a new Path. Cheap because segments
//     are short arrays of short strings.
//   - Eager normalization where possible: parse() collapses "." and "..".
//     A trailing ".." in a relative path can't be normalized without a cwd,
//     so it's preserved as a literal segment.
//   - "..-past-root" in an absolute path is a no-op (matches POSIX shells).
//   - Empty input is invalid; "." parses to the empty-segment relative path.

import { InvalidPathError } from "./errors.js";

const SEPARATOR = "/";
const PARENT = "..";
const CURRENT = ".";

export class Path {
  /** Path components, in order. Never contains "." or empty strings. May contain ".." only for relative paths. */
  readonly segments: readonly string[];

  /** True if the path is absolute (starts with "/"). */
  readonly isAbsolute: boolean;

  private constructor(segments: readonly string[], isAbsolute: boolean) {
    this.segments = Object.freeze([...segments]);
    this.isAbsolute = isAbsolute;
  }

  /** Returns the absolute root path ("/"). */
  static root(): Path {
    return new Path([], true);
  }

  /**
   * Parse a path string. Throws InvalidPathError for empty input.
   *
   * Normalizes:
   *   - Multiple slashes collapse: "//a//b" -> "/a/b"
   *   - "." segments are dropped: "a/./b" -> "a/b"
   *   - ".." pops the preceding non-".." segment: "a/b/.." -> "a"
   *   - ".." past the root of an absolute path is a no-op: "/.." -> "/"
   *   - Leading ".." in a relative path is preserved: "../a" stays "../a"
   */
  static parse(input: string): Path {
    if (input.length === 0) {
      throw new InvalidPathError(input, "path string must not be empty");
    }
    // The null byte is the one character every major filesystem (POSIX,
    // Windows, macOS) universally rejects in names. Historically a C-string
    // truncation primitive — `open("foo\0bar")` would open "foo". Other
    // policy (which chars a specific filesystem allows) belongs in the
    // FileSystem layer, not here.
    if (input.includes("\0")) {
      throw new InvalidPathError(input, "path must not contain a null byte");
    }
    const isAbsolute = input.startsWith(SEPARATOR);
    const raw = input.split(SEPARATOR).filter((s) => s.length > 0 && s !== CURRENT);

    const segments: string[] = [];
    for (const seg of raw) {
      if (seg === PARENT) {
        const last = segments[segments.length - 1];
        if (last !== undefined && last !== PARENT) {
          segments.pop();
        } else if (!isAbsolute) {
          // Relative path: a leading ".." can't be normalized without a cwd,
          // so we preserve it literally for later resolution.
          segments.push(seg);
        }
        // Absolute path: ".." at the root is a no-op (matches POSIX).
      } else {
        segments.push(seg);
      }
    }
    return new Path(segments, isAbsolute);
  }

  /** The last path segment, or null for the root or an empty relative path ("."). */
  get basename(): string | null {
    const last = this.segments[this.segments.length - 1];
    return last ?? null;
  }

  /**
   * The parent path.
   *   - Root ("/") is its own parent (matches POSIX).
   *   - "." -> ".."
   *   - "../a" -> ".."
   *   - "../.." -> "../../.."
   *   - "a" -> "."
   */
  get parent(): Path {
    if (this.segments.length === 0) {
      // Root's parent is itself; empty-relative path's parent is "..".
      return this.isAbsolute ? this : new Path([PARENT], false);
    }
    const last = this.segments[this.segments.length - 1];
    if (last === PARENT) {
      // Already climbing relative parents — add one more.
      return new Path([...this.segments, PARENT], false);
    }
    return new Path(this.segments.slice(0, -1), this.isAbsolute);
  }

  /**
   * Combine this path with another. If `other` is absolute, it replaces this
   * path. Otherwise, segments are appended and re-normalized.
   */
  join(other: Path | string): Path {
    const otherPath = typeof other === "string" ? Path.parse(other) : other;
    if (otherPath.isAbsolute) {
      return otherPath;
    }
    // Re-parse through parse() so the result is renormalized
    // (handles "a" + "../b" -> "b" cleanly).
    const prefix = this.isAbsolute ? SEPARATOR : "";
    const merged = [...this.segments, ...otherPath.segments].join(SEPARATOR);
    return Path.parse(prefix + merged || ".");
  }

  /**
   * Resolve this path against an absolute cwd. Absolute paths are returned
   * unchanged; relative paths are joined onto cwd and re-normalized.
   * Throws if cwd is not absolute.
   */
  resolve(cwd: Path): Path {
    if (this.isAbsolute) {
      return this;
    }
    if (!cwd.isAbsolute) {
      throw new InvalidPathError(cwd.toString(), "cwd must be absolute to resolve a relative path");
    }
    return cwd.join(this);
  }

  /** Canonical string form. Root is "/", empty relative is "." */
  toString(): string {
    if (this.segments.length === 0) {
      return this.isAbsolute ? SEPARATOR : CURRENT;
    }
    return (this.isAbsolute ? SEPARATOR : "") + this.segments.join(SEPARATOR);
  }

  /** Structural equality. */
  equals(other: Path): boolean {
    if (this.isAbsolute !== other.isAbsolute) return false;
    if (this.segments.length !== other.segments.length) return false;
    return this.segments.every((s, i) => s === other.segments[i]);
  }
}
