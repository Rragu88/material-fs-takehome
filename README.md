# material-fs

An in-memory virtual filesystem in TypeScript, written for the Material
Security take-home exercise.

## Quick start

```bash
npm install
npm test          # 76 tests across 2 spec files
npm run typecheck # strict TypeScript with noUncheckedIndexedAccess
```

## API at a glance

```ts
import { FileSystem } from "./src/filesystem.js";

const fs = new FileSystem();

// Navigation
fs.pwd(); // "/"
fs.cd("/some/path");

// Directories
fs.mkdir("docs");
fs.mkdir("a/b/c", { recursive: true });
fs.ls(); // string[]
fs.rmdir("docs");

// Files
fs.touch("notes.txt");
fs.writeFile("notes.txt", "hello");
fs.readFile("notes.txt");

// Move / rename
fs.mv("a", "b");
fs.mv("a/file", "b/");

// Find (recursive within cwd)
fs.find("target");

// Walk + recursive regex find (extension)
fs.walk(undefined, (node, path) => {
  /* return "skip" to prune */
});
fs.findRegex(/\.log$/);
```

Paths can be absolute (`/a/b`), relative (`a/b`, `./a`, `../a`), or use `..`
to traverse to parents. `..` at the root is a no-op (matches POSIX).

## What's in scope

| Capability                                                                          | Source                          |
| ----------------------------------------------------------------------------------- | ------------------------------- |
| `cd`, `pwd`, `mkdir`, `rmdir`, `ls`, `touch`, `readFile`, `writeFile`, `mv`, `find` | Base spec                       |
| Absolute and relative paths, `..` traversal, `mkdir -p` style intermediate creation | "Operations on paths" extension |
| `walk(path, visitor)` with prune-via-`"skip"`, plus `findRegex` built on top        | "Walk a subtree" extension      |

## What's out of scope (and why)

I committed to two extensions deeply rather than touching every extension
shallowly. Out of scope:

- **Copy** (`cp`) — the spec lists move _and_ copy together as one
  extension. I implemented `mv` (which the base spec requires anyway)
  and chose to spend the time on walk/regex find rather than on a
  separate copy primitive.
- **Symlinks and hardlinks** — would require either path-rewriting at
  resolution time (symlinks) or reference-counted shared content
  (hardlinks). Both interact non-trivially with `mv` and `rmdir`. Out of
  scope to keep the existing semantics tight.
- **Permissions and multiple users** — orthogonal to the tree structure.
  Could be layered on top by attaching a `permissions` field to `FsNode`
  and threading a `user` argument through public methods, but the design
  payoff is small relative to the line count.
- **Streaming I/O** — would require an async API surface, position
  tracking on Files, and lock coordination between writers and readers.
  A substantial subproject on its own.

## Design notes

### Module layout

| File                | Responsibility                                                                            |
| ------------------- | ----------------------------------------------------------------------------------------- |
| `src/path.ts`       | Immutable `Path` value object. Parsing, normalization (`.`, `..`), `join`, `resolve`.     |
| `src/node.ts`       | `FsNode` (abstract), `File`, `Directory`. Passive data — `FileSystem` manages invariants. |
| `src/filesystem.ts` | The `FileSystem` class. One session, one mutable cwd. All operations live here.           |
| `src/errors.ts`     | Custom error hierarchy. `FileSystemError` base + 7 subclasses.                            |

### Key decisions

**Path is a value object, not a string.** Every operation routes through
`Path.parse` then `Path.resolve(cwd)`. Centralizing path math means all
the edge cases (multiple slashes, `.`, `..`, `..-past-root`) have a single
canonical answer. The alternative — splitting strings in every method —
duplicates parsing bugs across the codebase.

**Names follow POSIX rules; `\0` is universally rejected.** Real
filesystems disagree on which characters are valid in names (HFS+ rejects
`:`, NTFS rejects much more, ext4 allows almost anything). The one rule
that's universal is the null byte — historically a C-string truncation
exploit primitive (`open("foo\0bar")` would open `"foo"`). We reject `\0`
at parse time and leave other policy to the caller.

**`cwd` is stored as a `Directory` reference, not a Path.** When an
ancestor of the cwd is moved or renamed, our cwd stays valid — its path
just changes. The single source of truth is the tree itself; the path is
derived. This is covered by a dedicated test
(`cwd remains valid when an ancestor is moved`).

**Errors throw rather than return `Result<T, E>`.** Filesystem errors are
exceptional, not control flow. Real `fs` APIs throw. Custom subclasses
(`PathNotFoundError`, `NotADirectoryError`, etc.) let callers catch
specific cases via `instanceof` without paying the everywhere-tax of
result wrapping.

**`rmdir` refuses to remove the cwd or its ancestors.** Real shells leave
you in a "ghost" directory in this case. Refusing is simpler to reason
about: the tree's invariant "every node is reachable from root" is
preserved by every operation.

**`find` is recursive within the search root, and excludes the root
itself.** The base spec is ambiguous about whether `find` is recursive,
but the non-recursive reading (`ls().includes(name)`) would make `find`
redundant. The extension language about "regex-find via walk" supports
the recursive reading. Output is absolute paths.

**`mv` extends naturally with paths.** Same-parent → rename;
different-parent → move; existing-target-dir → move into. Cycle detection
(`srcNode.contains(dstParent)`) prevents moving a directory into itself.

**`walk`'s visitor returns `"skip"` to prune.** The alternative API — a
`descend()` callback — is more powerful (pre/post-order in one call) but
adds API complexity. Spec only asked for prune; return-value is the
simpler shape.

### Strictness

- `strict: true`, `noUncheckedIndexedAccess: true`, `noImplicitAny: true`
- No `as` casts in `src/`
- No non-null assertions (`!`)
- All Map/array index access goes through explicit `undefined` checks

### Testing

- **vitest** with one spec per module.
- The README's example flow is implemented verbatim as a single end-to-end
  test (`README example sequence`).
- Coverage is by behavior, not by line.

## Tradeoffs and known limitations

| Limitation                                                     | Workaround / why we did it this way                                                                                                                |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| No `cp`                                                        | Would be ~30 lines but doubles the move/copy surface; chose walk over cp.                                                                          |
| No symlink/hardlink                                            | Significant design depth required; chose breadth across paths + walk instead.                                                                      |
| `String` for file content (not `Buffer`)                       | Spec says contents fit in memory; strings keep us framework-portable. Switching is a one-line change in `File`.                                    |
| `mv` is not atomic across multiple calls                       | Single-threaded JS makes single-call atomicity implicit; multi-step ops aren't transactional. Could be added with a Transaction wrapper if needed. |
| Reserved-name validation is policy in `FileSystem`, not `Path` | Path is library-level; FS layer enforces naming policy because different filesystems disagree. Adding new rules is a single-method change.         |

## What I'd build next, given more time

- **Snapshot / restore** — clone the tree to a value, restore later. Useful
  for tests and undo.
- **Iterators** for `ls` and `walk` so they don't allocate intermediate
  arrays for very large directories.
- **`cp` with merge** — would round out the move/copy extension. The
  current `mv` already handles the cycle/collision logic; copy would
  reuse it.
- **A `FileSystemError.cause`** chain so a `NotADirectoryError` at a deep
  path includes the context of what operation triggered it.

## Repo layout

```
material-fs/
├── src/
│   ├── errors.ts
│   ├── path.ts
│   ├── node.ts
│   └── filesystem.ts
├── tests/
│   ├── path.test.ts        # 29 tests
│   └── filesystem.test.ts  # 47 tests
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── README.md
```
