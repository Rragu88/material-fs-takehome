// In-memory filesystem.
//
// One instance models one "session": a tree of directories and files,
// plus a current working directory. All operations accept paths that
// may be absolute or relative (relative to cwd), thanks to the Path
// extension. Names within paths follow POSIX-ish rules:
//   - "/" separator
//   - "." current
//   - ".." parent (a no-op at the root)
//
// Out of scope (deliberately not implemented):
//   - Hardlinks (refcounted shared content)
//   - Permissions and multi-user
//   - Streaming I/O
//   - Cross-directory copy (the README's copy extension is out of scope;
//     mv is supported for both rename and cross-directory move)
//
// Implemented extensions:
//   - Paths: absolute, relative, "..", recursive mkdir
//   - Walk subtree: visitor pattern with prune-via-"skip"
//   - Symlinks: POSIX-style, with loop detection (max 40 hops)
//
// Design notes:
//   - Path resolution is centralized in `resolveNode` and
//     `resolveParentAndName`. Every public operation goes through one or
//     both. Adding a new operation should not require new path-parsing logic.
//   - The cwd is stored as a Directory reference, not a Path string, so
//     it remains valid across moves and renames of its ancestors.
//   - All name validation is in `validateName`. Adding a new naming rule
//     means one edit.

import {
  AlreadyExistsError,
  DirectoryNotEmptyError,
  InvalidOperationError,
  InvalidPathError,
  NotADirectoryError,
  NotAFileError,
  PathNotFoundError,
} from "./errors.js";
import { Directory, File, FsNode, Symlink } from "./node.js";
import { Path } from "./path.js";

/**
 * Maximum number of symlink hops to follow during a single path resolution.
 * Matches Linux's MAXSYMLINKS constant. Exceeding it throws
 * InvalidOperationError — the canonical signal of a symlink loop.
 */
const MAX_SYMLINK_DEPTH = 40;

/**
 * Return value from a walk visitor. Returning "skip" prevents descent into
 * the just-visited directory. Returning void (or undefined) descends.
 */
export type WalkAction = "skip" | void;
export type Visitor = (node: FsNode, path: string) => WalkAction;

export class FileSystem {
  private readonly root: Directory;
  private cwd: Directory;

  constructor() {
    this.root = new Directory("", null);
    this.cwd = this.root;
  }

  // ============================================================
  // Internal helpers
  // ============================================================

  /** Resolves a path string against the cwd and returns the canonical absolute Path. */
  private absolute(input: string | Path): Path {
    const parsed = typeof input === "string" ? Path.parse(input) : input;
    return parsed.resolve(this.cwdPath());
  }

  /** The absolute Path of the cwd. */
  private cwdPath(): Path {
    const segments = this.cwd.pathSegments();
    return segments.length === 0 ? Path.root() : Path.parse("/" + segments.join("/"));
  }

  /**
   * Walk the tree from root following the path's segments.
   *
   * Symlink behavior:
   *   - Intermediate segments are always followed.
   *   - The final segment is followed iff `options.followFinal` is true
   *     (the default). Operations that need the symlink itself (rmdir,
   *     mv source, readSymlink) pass `followFinal: false`.
   *
   * Throws:
   *   - PathNotFoundError if any segment doesn't exist
   *   - NotADirectoryError if an intermediate node is not a directory
   *   - InvalidOperationError on symlink loops (>= MAX_SYMLINK_DEPTH hops)
   */
  private resolveNode(input: string | Path, options: { followFinal?: boolean } = {}): FsNode {
    const followFinal = options.followFinal ?? true;
    return this.resolveNodeWith(this.absolute(input), followFinal, 0);
  }

  private resolveNodeWith(abs: Path, followFinal: boolean, depth: number): FsNode {
    if (depth > MAX_SYMLINK_DEPTH) {
      throw new InvalidOperationError(
        `too many symlink hops (max ${MAX_SYMLINK_DEPTH})`,
        abs.toString(),
      );
    }

    let cur: FsNode = this.root;
    const traversed: string[] = [];
    const lastIndex = abs.segments.length - 1;

    for (const [i, segment] of abs.segments.entries()) {
      if (!(cur instanceof Directory)) {
        throw new NotADirectoryError("/" + traversed.join("/"));
      }
      const child = cur.children.get(segment);
      if (child === undefined) {
        throw new PathNotFoundError(abs.toString());
      }
      traversed.push(segment);
      const isFinal = i === lastIndex;

      if (child instanceof Symlink && (!isFinal || followFinal)) {
        // Resolve the link's target. Relative targets are anchored to the
        // symlink's parent directory, not the cwd — POSIX semantics.
        const parent = child.parent;
        if (parent === null) {
          throw new InvalidOperationError("orphan symlink", abs.toString());
        }
        const targetPath = Path.parse(child.target).resolve(this.pathOf(parent));
        // Any remaining unresolved segments continue past the link's target.
        const tail = abs.segments.slice(i + 1);
        const fullPath = tail.length === 0 ? targetPath : targetPath.join(tail.join("/"));
        return this.resolveNodeWith(fullPath, followFinal, depth + 1);
      }

      cur = child;
    }
    return cur;
  }

  /** Absolute Path of any tree node. Root → "/". */
  private pathOf(node: FsNode): Path {
    const segments = node.pathSegments();
    return segments.length === 0 ? Path.root() : Path.parse("/" + segments.join("/"));
  }

  /**
   * Resolves the parent directory and the final-segment name for a create
   * or remove operation. Throws if the parent doesn't exist or isn't a
   * directory, or if the path refers to the root (which has no parent).
   */
  private resolveParentAndName(input: string | Path): { parent: Directory; name: string } {
    const abs = this.absolute(input);
    const name = abs.basename;
    if (name === null) {
      throw new InvalidOperationError("cannot operate on the root directory", abs.toString());
    }
    const parent = this.resolveNode(abs.parent);
    if (!(parent instanceof Directory)) {
      throw new NotADirectoryError(abs.parent.toString());
    }
    return { parent, name };
  }

  /** Centralized name validation for created or renamed entries. */
  private validateName(name: string): void {
    if (name.length === 0) {
      throw new InvalidPathError(name, "name must not be empty");
    }
    if (name === "." || name === "..") {
      throw new InvalidPathError(name, `"${name}" is a reserved name`);
    }
    if (name.includes("/")) {
      throw new InvalidPathError(name, "name must not contain '/'");
    }
    if (name.includes("\0")) {
      throw new InvalidPathError(name, "name must not contain a null byte");
    }
  }

  /**
   * Atomically attach a node into a parent at a given name. Throws
   * AlreadyExistsError on collision. Updates the node's name and parent.
   */
  private link(parent: Directory, name: string, node: FsNode): void {
    if (parent.children.has(name)) {
      const at = parent === this.root ? `/${name}` : `/${parent.pathSegments().join("/")}/${name}`;
      throw new AlreadyExistsError(at);
    }
    node.name = name;
    node.parent = parent;
    parent.children.set(name, node);
  }

  /** Atomically detach a node from its parent by name. Returns the node. */
  private unlink(parent: Directory, name: string): FsNode {
    const node = parent.children.get(name);
    if (node === undefined) {
      const at = parent === this.root ? `/${name}` : `/${parent.pathSegments().join("/")}/${name}`;
      throw new PathNotFoundError(at);
    }
    parent.children.delete(name);
    node.parent = null;
    return node;
  }

  // ============================================================
  // Navigation
  // ============================================================

  /** Returns the absolute path of the current working directory. */
  pwd(): string {
    return this.cwdPath().toString();
  }

  /**
   * Change the current working directory. Accepts:
   *   - "/absolute/path"
   *   - "relative/path"
   *   - ".." or "../.."
   *   - "/" (root)
   * Throws if the target doesn't exist or isn't a directory.
   */
  cd(path: string): void {
    const node = this.resolveNode(path);
    if (!(node instanceof Directory)) {
      throw new NotADirectoryError(path);
    }
    this.cwd = node;
  }

  // ============================================================
  // Directory operations
  // ============================================================

  /**
   * Create a new directory at the given path.
   * With `recursive: true`, intermediate directories are created as needed
   * and an existing target directory is silently accepted.
   */
  mkdir(path: string, options: { recursive?: boolean } = {}): void {
    if (options.recursive) {
      this.mkdirRecursive(path);
      return;
    }
    const { parent, name } = this.resolveParentAndName(path);
    this.validateName(name);
    this.link(parent, name, new Directory(name, parent));
  }

  private mkdirRecursive(path: string): void {
    const abs = this.absolute(path);
    let cur: Directory = this.root;
    for (const segment of abs.segments) {
      this.validateName(segment);
      const existing = cur.children.get(segment);
      if (existing === undefined) {
        const fresh = new Directory(segment, cur);
        cur.children.set(segment, fresh);
        cur = fresh;
      } else if (existing instanceof Directory) {
        cur = existing;
      } else {
        throw new NotADirectoryError("/" + cur.pathSegments().concat(segment).join("/"));
      }
    }
  }

  /**
   * Remove an empty directory. Refuses to remove:
   *   - the root
   *   - the current working directory
   *   - any ancestor of the current working directory
   *   - a non-empty directory
   *   - anything that isn't a directory
   */
  rmdir(path: string): void {
    // followFinal: false — rmdir operates on the named node itself. If it's
    // a symlink (even to a directory), it's "not a directory" and we throw.
    // To remove a directory reached through a symlink, the caller resolves
    // the path themselves.
    const target = this.resolveNode(path, { followFinal: false });
    if (!(target instanceof Directory)) {
      throw new NotADirectoryError(path);
    }
    if (target === this.root) {
      throw new InvalidOperationError("cannot remove root", "/");
    }
    if (target.contains(this.cwd)) {
      throw new InvalidOperationError("cannot remove the current directory or an ancestor", path);
    }
    if (target.children.size > 0) {
      throw new DirectoryNotEmptyError(path);
    }
    const parent = target.parent;
    if (parent === null) {
      throw new InvalidOperationError("orphan node has no parent", path);
    }
    this.unlink(parent, target.name);
  }

  /**
   * List the children of a directory by name. Returns insertion order
   * (Map preserves it). Defaults to cwd when no path is given.
   */
  ls(path?: string): string[] {
    const target = path === undefined ? this.cwd : this.resolveNode(path);
    if (!(target instanceof Directory)) {
      throw new NotADirectoryError(path ?? this.pwd());
    }
    return Array.from(target.children.keys());
  }

  // ============================================================
  // File operations
  // ============================================================

  /** Create an empty file at the given path. */
  touch(path: string): void {
    const { parent, name } = this.resolveParentAndName(path);
    this.validateName(name);
    this.link(parent, name, new File(name, parent));
  }

  /** Read a file's contents. Throws if the path is not a file. */
  readFile(path: string): string {
    const node = this.resolveNode(path);
    if (!(node instanceof File)) {
      throw new NotAFileError(path);
    }
    return node.content;
  }

  /** Overwrite a file's contents. Throws if the path is not a file. */
  writeFile(path: string, content: string): void {
    const node = this.resolveNode(path);
    if (!(node instanceof File)) {
      throw new NotAFileError(path);
    }
    node.content = content;
  }

  /**
   * Move or rename a node.
   *
   * Behavior:
   *   - If `dst` is an existing directory, the node is moved into it,
   *     keeping its current name. This matches the `mv src/ existing-dir/`
   *     behavior of POSIX `mv`.
   *   - Otherwise, the node is placed at `dst` (which may differ in both
   *     parent directory and name).
   *
   * Errors:
   *   - PathNotFoundError if src doesn't exist
   *   - InvalidOperationError if src is the root, or if moving a directory
   *     into itself or a descendant (would create a cycle)
   *   - AlreadyExistsError if the destination name is already taken
   */
  mv(src: string, dst: string): void {
    // followFinal: false on src — `mv link new` moves the link, not the
    // target it points to. Symlinks track paths-as-strings, so the link's
    // target is unchanged by the move (which can make a relative-target
    // link resolve differently from its new location — this is POSIX
    // behavior, not a bug).
    const srcNode = this.resolveNode(src, { followFinal: false });
    if (srcNode === this.root) {
      throw new InvalidOperationError("cannot move the root", src);
    }
    const srcParent = srcNode.parent;
    if (srcParent === null) {
      throw new InvalidOperationError("orphan node has no parent", src);
    }

    // Figure out the destination parent + name.
    let dstParent: Directory;
    let dstName: string;
    const dstAbs = this.absolute(dst);
    const dstExisting = this.tryResolveNode(dstAbs);
    if (dstExisting instanceof Directory) {
      dstParent = dstExisting;
      dstName = srcNode.name;
    } else if (dstExisting !== null) {
      throw new AlreadyExistsError(dstAbs.toString());
    } else {
      const resolved = this.resolveParentAndName(dstAbs);
      dstParent = resolved.parent;
      dstName = resolved.name;
    }

    this.validateName(dstName);

    // Cycle check: moving a directory into itself or a descendant would
    // detach a subtree from root.
    if (srcNode instanceof Directory && srcNode.contains(dstParent)) {
      throw new InvalidOperationError("cannot move a directory into itself or a descendant", dst);
    }

    // Collision check, but only after we've decided final dstParent/dstName.
    if (dstParent.children.has(dstName) && dstParent.children.get(dstName) !== srcNode) {
      throw new AlreadyExistsError(dstAbs.toString());
    }

    // Perform the move: unlink then link. If src and dst are the same
    // (same parent + same name), this is a no-op rename — we still need to
    // avoid the temporary unlinked state being observable, but since this
    // is single-threaded JS, atomicity is implicit.
    this.unlink(srcParent, srcNode.name);
    this.link(dstParent, dstName, srcNode);
  }

  /** Like resolveNode but returns null instead of throwing on not-found. */
  private tryResolveNode(input: string | Path): FsNode | null {
    try {
      return this.resolveNode(input);
    } catch (err) {
      if (err instanceof PathNotFoundError) return null;
      throw err;
    }
  }

  // ============================================================
  // Symlinks (extension)
  // ============================================================

  /**
   * Create a symbolic link at `linkPath` pointing to `target`.
   *
   * The target is stored as a literal string — broken links (pointing to
   * nothing) are allowed and become apparent at access time. Relative
   * targets are resolved against the link's parent directory when the
   * link is dereferenced, not against the cwd at creation time.
   */
  symlink(target: string, linkPath: string): void {
    if (target.length === 0 || target.includes("\0")) {
      throw new InvalidPathError(
        target,
        "symlink target must be a non-empty path without null bytes",
      );
    }
    const { parent, name } = this.resolveParentAndName(linkPath);
    this.validateName(name);
    this.link(parent, name, new Symlink(name, parent, target));
  }

  /**
   * Return the literal target string of a symlink (does not follow it).
   * Throws InvalidOperationError if the path doesn't refer to a symlink.
   */
  readSymlink(path: string): string {
    const node = this.resolveNode(path, { followFinal: false });
    if (!(node instanceof Symlink)) {
      throw new InvalidOperationError("not a symlink", path);
    }
    return node.target;
  }

  // ============================================================
  // Find (base spec)
  // ============================================================

  /**
   * Recursively find files and directories within `at` (default cwd) whose
   * name exactly matches. Excludes the start directory itself. Returns
   * absolute paths.
   *
   * Note on interpretation: the spec says "find all files and directories
   * within the current working directory that have exactly that name."
   * The non-recursive reading is identical to `ls().includes(name)`, which
   * would make `find` redundant. I read "within" as recursive descent.
   */
  find(name: string, at?: string): string[] {
    this.validateName(name);
    const matches: string[] = [];
    const start = at === undefined ? this.cwd : this.resolveNode(at);
    this.walkFrom(start, (node, path) => {
      if (node !== start && node.name === name) {
        matches.push(path);
      }
    });
    return matches;
  }

  // ============================================================
  // Walk subtree (extension)
  // ============================================================

  /**
   * Recursively visit every node in a subtree (default: cwd). The visitor
   * is called with the node and its absolute path. Return "skip" from the
   * visitor to prevent descent into the just-visited directory.
   */
  walk(at: string | undefined, visitor: Visitor): void {
    const start = at === undefined ? this.cwd : this.resolveNode(at);
    this.walkFrom(start, visitor);
  }

  private walkFrom(start: FsNode, visitor: Visitor): void {
    const startSegments = start.pathSegments();
    const recurse = (node: FsNode, segments: string[]): void => {
      const path = segments.length === 0 ? "/" : "/" + segments.join("/");
      const action = visitor(node, path);
      if (action === "skip") return;
      // Don't descend through symlinks — a symlink could point to an
      // ancestor and create infinite traversal. Match GNU find's default
      // behavior (the -L flag opts into following).
      if (node instanceof Directory) {
        for (const child of node.children.values()) {
          recurse(child, [...segments, child.name]);
        }
      }
    };
    recurse(start, startSegments);
  }

  /**
   * Recursive regex search using walk. Excludes the start directory.
   * Demonstrates how walk supports higher-level recursive operations.
   */
  findRegex(pattern: RegExp, at?: string): string[] {
    const matches: string[] = [];
    const start = at === undefined ? this.cwd : this.resolveNode(at);
    this.walkFrom(start, (node, path) => {
      if (node !== start && pattern.test(node.name)) {
        matches.push(path);
      }
    });
    return matches;
  }
}
