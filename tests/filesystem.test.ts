import { beforeEach, describe, expect, it } from "vitest";

import {
  AlreadyExistsError,
  DirectoryNotEmptyError,
  InvalidOperationError,
  InvalidPathError,
  NotADirectoryError,
  NotAFileError,
  PathNotFoundError,
} from "../src/errors.js";
import { FileSystem } from "../src/filesystem.js";

describe("FileSystem — README example sequence (end-to-end)", () => {
  it("walks through the canonical example flow", () => {
    const fs = new FileSystem();

    fs.mkdir("school");
    fs.cd("school");
    expect(fs.pwd()).toBe("/school");

    fs.mkdir("homework");
    fs.cd("homework");
    fs.mkdir("math");
    fs.mkdir("lunch");
    fs.mkdir("history");
    fs.mkdir("spanish");
    fs.rmdir("lunch");
    expect(fs.ls()).toEqual(["math", "history", "spanish"]);
    expect(fs.pwd()).toBe("/school/homework");

    fs.cd("..");
    fs.mkdir("cheatsheet");
    expect(fs.ls()).toEqual(["homework", "cheatsheet"]);
    fs.rmdir("cheatsheet");

    fs.cd("..");
    expect(fs.pwd()).toBe("/");
  });
});

describe("FileSystem — pwd and cd", () => {
  let fs: FileSystem;
  beforeEach(() => {
    fs = new FileSystem();
  });

  it("starts at the root", () => {
    expect(fs.pwd()).toBe("/");
  });

  it("handles absolute paths", () => {
    fs.mkdir("/a");
    fs.mkdir("/a/b");
    fs.cd("/a/b");
    expect(fs.pwd()).toBe("/a/b");
  });

  it("handles relative paths and '..'", () => {
    fs.mkdir("/a");
    fs.mkdir("/a/b");
    fs.cd("/a/b");
    fs.cd("../..");
    expect(fs.pwd()).toBe("/");
  });

  it("'..' at root is a no-op", () => {
    fs.cd("..");
    expect(fs.pwd()).toBe("/");
    fs.cd("/..");
    expect(fs.pwd()).toBe("/");
  });

  it("throws on cd to a non-existent path", () => {
    expect(() => fs.cd("/missing")).toThrow(PathNotFoundError);
  });

  it("throws on cd to a file", () => {
    fs.touch("/note");
    expect(() => fs.cd("/note")).toThrow(NotADirectoryError);
  });
});

describe("FileSystem — mkdir and rmdir", () => {
  let fs: FileSystem;
  beforeEach(() => {
    fs = new FileSystem();
  });

  it("creates a directory and lists it", () => {
    fs.mkdir("a");
    expect(fs.ls()).toEqual(["a"]);
  });

  it("rejects reserved names", () => {
    expect(() => fs.mkdir(".")).toThrow(InvalidOperationError); // root has no parent for "."
    expect(() => fs.mkdir("/..")).toThrow(InvalidOperationError);
  });

  it("rejects creating a directory whose parent doesn't exist", () => {
    expect(() => fs.mkdir("/a/b")).toThrow(PathNotFoundError);
  });

  it("rejects creating a duplicate", () => {
    fs.mkdir("/a");
    expect(() => fs.mkdir("/a")).toThrow(AlreadyExistsError);
  });

  it("supports recursive creation of intermediate directories", () => {
    fs.mkdir("/a/b/c", { recursive: true });
    expect(fs.ls("/a")).toEqual(["b"]);
    expect(fs.ls("/a/b")).toEqual(["c"]);
  });

  it("recursive creation accepts existing intermediate directories", () => {
    fs.mkdir("/a");
    fs.mkdir("/a/b/c", { recursive: true });
    expect(fs.ls("/a")).toEqual(["b"]);
  });

  it("recursive creation fails if an intermediate is a file", () => {
    fs.touch("/a");
    expect(() => fs.mkdir("/a/b", { recursive: true })).toThrow(NotADirectoryError);
  });

  it("rmdir refuses to remove root", () => {
    expect(() => fs.rmdir("/")).toThrow(InvalidOperationError);
  });

  it("rmdir refuses non-empty directories", () => {
    fs.mkdir("/a");
    fs.touch("/a/file");
    expect(() => fs.rmdir("/a")).toThrow(DirectoryNotEmptyError);
  });

  it("rmdir refuses the cwd or its ancestors", () => {
    fs.mkdir("/a");
    fs.mkdir("/a/b");
    fs.cd("/a/b");
    expect(() => fs.rmdir("/a/b")).toThrow(InvalidOperationError);
    expect(() => fs.rmdir("/a")).toThrow(InvalidOperationError);
  });

  it("rmdir refuses to remove a file", () => {
    fs.touch("/note");
    expect(() => fs.rmdir("/note")).toThrow(NotADirectoryError);
  });
});

describe("FileSystem — ls", () => {
  let fs: FileSystem;
  beforeEach(() => {
    fs = new FileSystem();
  });

  it("preserves insertion order", () => {
    fs.mkdir("c");
    fs.mkdir("a");
    fs.mkdir("b");
    expect(fs.ls()).toEqual(["c", "a", "b"]);
  });

  it("accepts an explicit path", () => {
    fs.mkdir("/a");
    fs.mkdir("/a/x");
    fs.mkdir("/a/y");
    expect(fs.ls("/a")).toEqual(["x", "y"]);
  });

  it("returns [] for an empty directory", () => {
    fs.mkdir("/a");
    expect(fs.ls("/a")).toEqual([]);
  });

  it("throws on a file path", () => {
    fs.touch("/f");
    expect(() => fs.ls("/f")).toThrow(NotADirectoryError);
  });
});

describe("FileSystem — file operations", () => {
  let fs: FileSystem;
  beforeEach(() => {
    fs = new FileSystem();
  });

  it("touch creates an empty file", () => {
    fs.touch("/note");
    expect(fs.readFile("/note")).toBe("");
  });

  it("writeFile and readFile roundtrip", () => {
    fs.touch("/note");
    fs.writeFile("/note", "hello world");
    expect(fs.readFile("/note")).toBe("hello world");
  });

  it("writeFile overwrites existing content", () => {
    fs.touch("/note");
    fs.writeFile("/note", "first");
    fs.writeFile("/note", "second");
    expect(fs.readFile("/note")).toBe("second");
  });

  it("readFile / writeFile reject directories", () => {
    fs.mkdir("/d");
    expect(() => fs.readFile("/d")).toThrow(NotAFileError);
    expect(() => fs.writeFile("/d", "x")).toThrow(NotAFileError);
  });

  it("touch on a duplicate name throws", () => {
    fs.touch("/a");
    expect(() => fs.touch("/a")).toThrow(AlreadyExistsError);
  });
});

describe("FileSystem — mv", () => {
  let fs: FileSystem;
  beforeEach(() => {
    fs = new FileSystem();
  });

  it("renames a file in the same directory", () => {
    fs.touch("/a");
    fs.mv("/a", "/b");
    expect(fs.ls()).toEqual(["b"]);
  });

  it("moves a file into another directory", () => {
    fs.touch("/a");
    fs.mkdir("/d");
    fs.mv("/a", "/d");
    expect(fs.ls("/")).toEqual(["d"]);
    expect(fs.ls("/d")).toEqual(["a"]);
  });

  it("moves and renames in one operation", () => {
    fs.touch("/a");
    fs.mkdir("/d");
    fs.mv("/a", "/d/renamed");
    expect(fs.ls("/d")).toEqual(["renamed"]);
  });

  it("moves a directory and keeps its contents", () => {
    fs.mkdir("/src");
    fs.touch("/src/file");
    fs.mkdir("/dst");
    fs.mv("/src", "/dst");
    expect(fs.ls("/dst/src")).toEqual(["file"]);
  });

  it("refuses to move root", () => {
    expect(() => fs.mv("/", "/somewhere")).toThrow(InvalidOperationError);
  });

  it("refuses to move a directory into itself or a descendant", () => {
    fs.mkdir("/a");
    fs.mkdir("/a/b");
    expect(() => fs.mv("/a", "/a/b")).toThrow(InvalidOperationError);
    expect(() => fs.mv("/a", "/a")).toThrow(InvalidOperationError);
  });

  it("refuses to move onto an existing file of different identity", () => {
    fs.touch("/a");
    fs.touch("/b");
    expect(() => fs.mv("/a", "/b")).toThrow(AlreadyExistsError);
  });

  it("cwd remains valid when an ancestor is moved", () => {
    fs.mkdir("/a/b/c", { recursive: true });
    fs.cd("/a/b/c");
    fs.mkdir("/elsewhere");
    fs.mv("/a", "/elsewhere");
    expect(fs.pwd()).toBe("/elsewhere/a/b/c");
  });
});

describe("FileSystem — find (recursive within cwd)", () => {
  let fs: FileSystem;
  beforeEach(() => {
    fs = new FileSystem();
    fs.mkdir("/a/b/c", { recursive: true });
    fs.touch("/a/target");
    fs.touch("/a/b/target");
    fs.touch("/a/b/c/target");
    fs.touch("/a/b/c/other");
  });

  it("finds all matching descendants from cwd", () => {
    fs.cd("/a");
    expect(fs.find("target").sort()).toEqual(["/a/b/c/target", "/a/b/target", "/a/target"].sort());
  });

  it("excludes the start node itself even on name match", () => {
    fs.mkdir("/match");
    fs.cd("/match");
    fs.touch("/match/match");
    expect(fs.find("match")).toEqual(["/match/match"]);
  });

  it("accepts an explicit search root", () => {
    expect(fs.find("target", "/a/b").sort()).toEqual(["/a/b/c/target", "/a/b/target"].sort());
  });

  it("returns [] when nothing matches", () => {
    expect(fs.find("missing")).toEqual([]);
  });

  it("rejects invalid names", () => {
    expect(() => fs.find("")).toThrow(InvalidPathError);
    expect(() => fs.find("a/b")).toThrow(InvalidPathError);
    expect(() => fs.find("..")).toThrow(InvalidPathError);
  });
});

describe("FileSystem — walk subtree (extension)", () => {
  let fs: FileSystem;
  beforeEach(() => {
    fs = new FileSystem();
    fs.mkdir("/a/b/c", { recursive: true });
    fs.touch("/a/file1");
    fs.touch("/a/b/file2");
    fs.touch("/a/b/c/file3");
  });

  it("visits every node in the subtree", () => {
    const visited: string[] = [];
    fs.walk("/a", (_node, path) => {
      visited.push(path);
    });
    expect(visited.sort()).toEqual(
      ["/a", "/a/b", "/a/b/c", "/a/b/c/file3", "/a/b/file2", "/a/file1"].sort(),
    );
  });

  it("'skip' return value prunes a subtree", () => {
    const visited: string[] = [];
    fs.walk("/a", (_node, path) => {
      visited.push(path);
      if (path === "/a/b") return "skip";
    });
    // /a/b/* should be excluded
    expect(visited).toContain("/a");
    expect(visited).toContain("/a/file1");
    expect(visited).toContain("/a/b");
    expect(visited).not.toContain("/a/b/file2");
    expect(visited).not.toContain("/a/b/c");
  });

  it("defaults to cwd when no path is given", () => {
    fs.cd("/a/b");
    const visited: string[] = [];
    fs.walk(undefined, (_node, path) => {
      visited.push(path);
    });
    expect(visited.sort()).toEqual(["/a/b", "/a/b/c", "/a/b/c/file3", "/a/b/file2"].sort());
  });

  it("findRegex finds names matching a pattern", () => {
    expect(fs.findRegex(/^file/, "/a").sort()).toEqual(
      ["/a/b/c/file3", "/a/b/file2", "/a/file1"].sort(),
    );
    expect(fs.findRegex(/^z/, "/a")).toEqual([]);
  });
});

describe("FileSystem — symlinks (extension)", () => {
  let fs: FileSystem;
  beforeEach(() => {
    fs = new FileSystem();
  });

  it("creates a symlink and reads its literal target", () => {
    fs.mkdir("/target");
    fs.symlink("/target", "/link");
    expect(fs.readSymlink("/link")).toBe("/target");
  });

  it("follows a symlink to a file when reading content", () => {
    fs.touch("/file");
    fs.writeFile("/file", "hello");
    fs.symlink("/file", "/link");
    expect(fs.readFile("/link")).toBe("hello");
  });

  it("follows a symlink to a directory when listing", () => {
    fs.mkdir("/dir");
    fs.touch("/dir/a");
    fs.touch("/dir/b");
    fs.symlink("/dir", "/link");
    expect(fs.ls("/link")).toEqual(["a", "b"]);
  });

  it("follows symlinks in intermediate path segments", () => {
    fs.mkdir("/a/b/c", { recursive: true });
    fs.touch("/a/b/c/file");
    fs.writeFile("/a/b/c/file", "found me");
    fs.symlink("/a/b", "/shortcut");
    expect(fs.readFile("/shortcut/c/file")).toBe("found me");
  });

  it("supports cd through a symlink", () => {
    fs.mkdir("/long/path/to/place", { recursive: true });
    fs.symlink("/long/path/to/place", "/short");
    fs.cd("/short");
    // pwd reports the canonical resolved path, not the symlink path
    expect(fs.pwd()).toBe("/long/path/to/place");
  });

  it("resolves relative symlink targets against the symlink's parent dir", () => {
    fs.mkdir("/a/b", { recursive: true });
    fs.touch("/a/sibling");
    fs.writeFile("/a/sibling", "hi");
    // Link inside /a/b points to "../sibling" — should resolve to /a/sibling
    fs.symlink("../sibling", "/a/b/link");
    expect(fs.readFile("/a/b/link")).toBe("hi");
  });

  it("permits broken symlinks (creation does not validate target)", () => {
    fs.symlink("/does/not/exist", "/link");
    expect(fs.readSymlink("/link")).toBe("/does/not/exist");
    expect(() => fs.readFile("/link")).toThrow(PathNotFoundError);
  });

  it("detects symlink loops", () => {
    fs.symlink("/b", "/a");
    fs.symlink("/a", "/b");
    expect(() => fs.readFile("/a")).toThrow(InvalidOperationError);
    expect(() => fs.cd("/a")).toThrow(InvalidOperationError);
  });

  it("rmdir refuses to operate on a symlink (even one pointing to a dir)", () => {
    fs.mkdir("/dir");
    fs.symlink("/dir", "/link");
    expect(() => fs.rmdir("/link")).toThrow(NotADirectoryError);
    // The original directory remains
    expect(fs.ls("/dir")).toEqual([]);
  });

  it("mv moves the link itself, not the target", () => {
    fs.touch("/file");
    fs.writeFile("/file", "data");
    fs.symlink("/file", "/link");
    fs.mv("/link", "/relocated");
    // Link is gone from its old location
    expect(() => fs.readSymlink("/link")).toThrow(PathNotFoundError);
    // Link is at the new location, pointing to the same target
    expect(fs.readSymlink("/relocated")).toBe("/file");
    expect(fs.readFile("/relocated")).toBe("data");
    // The actual file is untouched
    expect(fs.readFile("/file")).toBe("data");
  });

  it("walk does not descend into symlinks", () => {
    fs.mkdir("/dir");
    fs.touch("/dir/file");
    fs.symlink("/dir", "/link");
    const visited: string[] = [];
    fs.walk("/", (_node, path) => {
      visited.push(path);
    });
    expect(visited).toContain("/link"); // the link itself is visited as a leaf
    expect(visited).not.toContain("/link/file"); // but not its target's contents
  });

  it("readSymlink rejects non-symlink paths", () => {
    fs.mkdir("/dir");
    fs.touch("/file");
    expect(() => fs.readSymlink("/dir")).toThrow(InvalidOperationError);
    expect(() => fs.readSymlink("/file")).toThrow(InvalidOperationError);
  });

  it("resolves chains of symlinks up to MAX_SYMLINK_DEPTH", () => {
    fs.touch("/end");
    fs.writeFile("/end", "ok");
    fs.symlink("/end", "/a");
    fs.symlink("/a", "/b");
    fs.symlink("/b", "/c");
    expect(fs.readFile("/c")).toBe("ok");
  });

  it("rejects symlinks with empty or null-containing targets", () => {
    expect(() => fs.symlink("", "/link")).toThrow(InvalidPathError);
    expect(() => fs.symlink("a\0b", "/link")).toThrow(InvalidPathError);
  });
});

describe("FileSystem — path edge cases", () => {
  let fs: FileSystem;
  beforeEach(() => {
    fs = new FileSystem();
  });

  it("'.' refers to the cwd", () => {
    fs.mkdir("/a");
    fs.cd("/a");
    fs.mkdir("./b");
    expect(fs.ls()).toEqual(["b"]);
  });

  it("collapses redundant separators in paths", () => {
    fs.mkdir("///a");
    expect(fs.ls()).toEqual(["a"]);
  });

  it("rejects null bytes in path strings", () => {
    expect(() => fs.mkdir("/a\0b")).toThrow(InvalidPathError);
  });
});
