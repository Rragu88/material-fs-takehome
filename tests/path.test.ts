import { describe, expect, it } from "vitest";

import { InvalidPathError } from "../src/errors.js";
import { Path } from "../src/path.js";

describe("Path.parse", () => {
  it("parses the root", () => {
    const p = Path.parse("/");
    expect(p.isAbsolute).toBe(true);
    expect(p.segments).toEqual([]);
    expect(p.toString()).toBe("/");
  });

  it("parses a simple absolute path", () => {
    const p = Path.parse("/a/b/c");
    expect(p.isAbsolute).toBe(true);
    expect(p.segments).toEqual(["a", "b", "c"]);
    expect(p.toString()).toBe("/a/b/c");
  });

  it("parses a simple relative path", () => {
    const p = Path.parse("a/b/c");
    expect(p.isAbsolute).toBe(false);
    expect(p.segments).toEqual(["a", "b", "c"]);
    expect(p.toString()).toBe("a/b/c");
  });

  it("collapses multiple slashes", () => {
    expect(Path.parse("//a//b").toString()).toBe("/a/b");
    expect(Path.parse("a///b").toString()).toBe("a/b");
  });

  it("drops trailing slash", () => {
    expect(Path.parse("/a/b/").toString()).toBe("/a/b");
  });

  it("drops '.' segments", () => {
    expect(Path.parse("/a/./b").toString()).toBe("/a/b");
    expect(Path.parse(".").toString()).toBe(".");
    expect(Path.parse("./a").toString()).toBe("a");
  });

  it("normalizes '..' within a path", () => {
    expect(Path.parse("/a/b/..").toString()).toBe("/a");
    expect(Path.parse("a/b/..").toString()).toBe("a");
    expect(Path.parse("/a/b/../c").toString()).toBe("/a/c");
  });

  it("treats '..' past root as a no-op for absolute paths", () => {
    expect(Path.parse("/..").toString()).toBe("/");
    expect(Path.parse("/../..").toString()).toBe("/");
    expect(Path.parse("/a/../../b").toString()).toBe("/b");
  });

  it("preserves leading '..' in relative paths", () => {
    expect(Path.parse("..").toString()).toBe("..");
    expect(Path.parse("../a").toString()).toBe("../a");
    expect(Path.parse("../..").toString()).toBe("../..");
    expect(Path.parse("a/../..").toString()).toBe("..");
  });

  it("throws on empty input", () => {
    expect(() => Path.parse("")).toThrow(InvalidPathError);
  });

  it("rejects null bytes anywhere in the path", () => {
    expect(() => Path.parse("\0")).toThrow(InvalidPathError);
    expect(() => Path.parse("a\0b")).toThrow(InvalidPathError);
    expect(() => Path.parse("/foo\0/bar")).toThrow(InvalidPathError);
  });
});

describe("Path.root", () => {
  it("returns an absolute path with no segments", () => {
    const root = Path.root();
    expect(root.isAbsolute).toBe(true);
    expect(root.segments).toEqual([]);
    expect(root.toString()).toBe("/");
  });
});

describe("Path.basename", () => {
  it("returns the last segment", () => {
    expect(Path.parse("/a/b/c").basename).toBe("c");
    expect(Path.parse("a/b").basename).toBe("b");
  });

  it("returns null for root and empty relative paths", () => {
    expect(Path.root().basename).toBe(null);
    expect(Path.parse(".").basename).toBe(null);
  });

  it("returns '..' for parent-only paths", () => {
    expect(Path.parse("..").basename).toBe("..");
  });
});

describe("Path.parent", () => {
  it("returns the parent of an absolute path", () => {
    expect(Path.parse("/a/b").parent.toString()).toBe("/a");
    expect(Path.parse("/a").parent.toString()).toBe("/");
  });

  it("returns root as the parent of root (POSIX semantics)", () => {
    expect(Path.root().parent.equals(Path.root())).toBe(true);
  });

  it("returns '..' as the parent of '.'", () => {
    expect(Path.parse(".").parent.toString()).toBe("..");
  });

  it("climbs an extra '..' when already at a parent-only path", () => {
    expect(Path.parse("..").parent.toString()).toBe("../..");
    expect(Path.parse("../a").parent.toString()).toBe("..");
  });
});

describe("Path.join", () => {
  it("appends a relative path", () => {
    expect(Path.parse("/a").join("b").toString()).toBe("/a/b");
    expect(Path.parse("a").join("b").toString()).toBe("a/b");
  });

  it("returns the right-hand side if it is absolute", () => {
    expect(Path.parse("/a").join("/b").toString()).toBe("/b");
  });

  it("normalizes '..' across the join boundary", () => {
    expect(Path.parse("/a/b").join("../c").toString()).toBe("/a/c");
    expect(Path.parse("a/b").join("../../c").toString()).toBe("c");
  });

  it("accepts a Path instance", () => {
    expect(Path.parse("/a").join(Path.parse("b/c")).toString()).toBe("/a/b/c");
  });
});

describe("Path.resolve", () => {
  it("returns absolute paths unchanged", () => {
    const p = Path.parse("/a/b");
    expect(p.resolve(Path.parse("/cwd")).equals(p)).toBe(true);
  });

  it("resolves a relative path against the cwd", () => {
    expect(Path.parse("b/c").resolve(Path.parse("/a")).toString()).toBe("/a/b/c");
    expect(Path.parse("../x").resolve(Path.parse("/a/b")).toString()).toBe("/a/x");
  });

  it("throws when cwd is not absolute", () => {
    expect(() => Path.parse("a").resolve(Path.parse("b"))).toThrow(InvalidPathError);
  });
});

describe("Path.equals", () => {
  it("returns true for structurally equal paths", () => {
    expect(Path.parse("/a/b").equals(Path.parse("/a/b"))).toBe(true);
    expect(Path.parse("/a/./b/../b").equals(Path.parse("/a/b"))).toBe(true);
  });

  it("returns false for differing absolute/relative", () => {
    expect(Path.parse("/a").equals(Path.parse("a"))).toBe(false);
  });

  it("returns false for differing segments", () => {
    expect(Path.parse("/a/b").equals(Path.parse("/a/c"))).toBe(false);
    expect(Path.parse("/a").equals(Path.parse("/a/b"))).toBe(false);
  });
});
