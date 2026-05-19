// Filesystem node types: files and directories.
//
// Named `FsNode` (not `Node`) to avoid colliding with the DOM Node global
// that TypeScript pulls into scope via its default lib.
//
// Design choice: these classes are *passive data*. They expose mutable
// `name` and `parent` fields because the FileSystem layer needs to manage
// the parent/child relationship atomically (on move, rename, delete). The
// alternative — making everything private with setters — adds ceremony
// without preventing misuse, because TS has no friend-class facility.
// The convention: only `FileSystem` mutates these fields. External callers
// treat them as read-only.

export abstract class FsNode {
  constructor(
    public name: string,
    public parent: Directory | null,
  ) {}

  /**
   * Returns the path segments from root to this node, exclusive of the
   * root itself. Root returns []. /a returns ["a"]. /a/b returns ["a", "b"].
   */
  pathSegments(): string[] {
    const segments: string[] = [];
    let cur: FsNode | null = this;
    while (cur !== null && cur.parent !== null) {
      segments.unshift(cur.name);
      cur = cur.parent;
    }
    return segments;
  }
}

export class File extends FsNode {
  constructor(
    name: string,
    parent: Directory,
    public content: string = "",
  ) {
    super(name, parent);
  }
}

export class Directory extends FsNode {
  readonly children: Map<string, FsNode> = new Map();

  constructor(name: string, parent: Directory | null) {
    super(name, parent);
  }

  /** Returns true if `candidate` is this directory or any of its descendants. */
  contains(candidate: FsNode): boolean {
    let cur: FsNode | null = candidate;
    while (cur !== null) {
      if (cur === this) return true;
      cur = cur.parent;
    }
    return false;
  }
}
