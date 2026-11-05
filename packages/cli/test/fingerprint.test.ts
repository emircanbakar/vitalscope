import { describe, expect, it } from "vitest";
import { errorGroup } from "../src/fingerprint.js";

const key = (message: string, stack: string[] = [], type = "Error") => errorGroup(type, message, stack).key;
const location = (stack: string[]) => errorGroup("Error", "x", stack).location;

// Vite sayfasında Chromium, Firefox ve WebKit'in ürettiği gerçek stack'ler.
const CHROMIUM = ["at loadUser (http://localhost:58964/src/lib.js:1:38)", "at HTMLButtonElement.onClick (http://localhost:58964/src/main.js:5:77)"];
const FIREFOX = ["loadUser@http://localhost:58964/src/lib.js:1:38", "onClick@http://localhost:58964/src/main.js:5:85", "EventListener.handleEvent*@http://localhost:58964/src/main.js:5:30"];
const WEBKIT = ["loadUser@http://localhost:58964/src/lib.js:1:47", "onClick@http://localhost:58964/src/main.js:5:85"];

describe("errorGroup", () => {
  it("reads the frame formats of all three browsers the same way", () => {
    expect(location(CHROMIUM)).toBe("loadUser (/src/lib.js)");
    expect(location(FIREFOX)).toBe("loadUser (/src/lib.js)");
    expect(location(WEBKIT)).toBe("loadUser (/src/lib.js)");
    expect(key("x", CHROMIUM)).toBe(key("x", FIREFOX));
    expect(key("x", FIREFOX)).toBe(key("x", WEBKIT));
  });

  it("treats every spelling of an anonymous function as no name", () => {
    const expected = "/src/main.js";
    expect(location(["at http://localhost:1/src/main.js:7:112"])).toBe(expected);
    expect(location(["at HTMLButtonElement.<anonymous> (http://localhost:1/src/main.js:6:69)"])).toBe(expected);
    expect(location(["later/<@http://localhost:1/src/main.js:7:112"])).toBe(expected);
    expect(location(["@http://localhost:1/src/main.js:7:126"])).toBe(expected);
  });

  it("reads async frames and scoped package paths", () => {
    expect(location(["at async load (http://localhost:1/src/a.js:1:1)"])).toBe("load (/src/a.js)");
    expect(location(["http://localhost:1/@scope/a.js:1:1"])).toBe("/@scope/a.js");
    expect(location(["load@http://localhost:1/@scope/a.js:1:1"])).toBe("load (/@scope/a.js)");
  });

  it("does not split an error when code moves or the server changes", () => {
    const base = key("x", ["at load (http://localhost:5173/src/a.js:1:1)"]);
    expect(key("x", ["at load (http://localhost:5173/src/a.js:90:7)"])).toBe(base);
    expect(key("x", ["at load (http://localhost:4173/src/a.js:1:1)"])).toBe(base);
    expect(key("x", ["at load (http://localhost:5173/src/a.js?t=1712345678:1:1)"])).toBe(base);
    expect(key("x", ["at load (http://127.0.0.1:5173/src/a.js#h:1:1)"])).toBe(base);
  });

  it("does not split an error when a rebuild changes the file hash", () => {
    expect(location(["at Se (http://localhost:1/assets/index-CyA1sY9x.js:2:6648)"])).toBe("Se (/assets/index.js)");
    expect(location(["at Se (http://localhost:1/js/main.a1b2c3d4.js:2:1)"])).toBe("Se (/js/main.js)");
    expect(location(["at Se (http://localhost:1/_next/static/chunks/app/page-0a1b2c3d4e.js:2:1)"])).toBe("Se (/_next/static/chunks/app/page.js)");
  });

  it("keeps ordinary file names", () => {
    expect(location(["at a (http://localhost:1/src/my-component.js:1:1)"])).toBe("a (/src/my-component.js)");
  });

  it("ignores values inside the message", () => {
    expect(key("User 42 not found")).toBe(key("User 43 not found"));
    expect(key("took 1.5 s")).toBe(key("took 20 s"));
    expect(key("no 3f9a0c1d2e4b")).toBe(key("no 00ff00ff00ff"));
    expect(key("no 0xdeadbeef1")).toBe(key("no 0x12345678a"));
    expect(key("no 123e4567-e89b-12d3-a456-426614174000")).toBe(key("no 00000000-0000-4000-8000-000000000000"));
  });

  it("keeps words that tell errors apart", () => {
    expect(key("reading 'id'")).not.toBe(key("reading 'name'"));
    expect(key("no h1")).not.toBe(key("no h2"));
    expect(key("defaced")).not.toBe(key("effacing"));
  });

  it("separates by type, function and file", () => {
    const base = key("x", ["at a (http://localhost:1/src/a.js:1:1)"]);
    expect(key("x", ["at a (http://localhost:1/src/a.js:1:1)"], "TypeError")).not.toBe(base);
    expect(key("x", ["at b (http://localhost:1/src/a.js:1:1)"])).not.toBe(base);
    expect(key("x", ["at a (http://localhost:1/src/b.js:1:1)"])).not.toBe(base);
  });

  it("uses the first frame of the application, not of a dependency", () => {
    const vendor = "at dispatch (http://localhost:1/node_modules/.vite/deps/react-dom.js:9:9)";
    expect(location([vendor, "at save (http://localhost:1/src/a.js:1:1)"])).toBe("save (/src/a.js)");
  });

  it("falls back to a dependency when the stack has nothing else", () => {
    expect(location(["at dispatch (http://localhost:1/node_modules/x/index.js:9:9)"])).toBe("dispatch (/node_modules/x/index.js)");
  });

  it("skips lines that are not positions in a file", () => {
    expect(location(["at Array.map (<anonymous>)", "map@[native code]", "second line of a message", "at a (http://localhost:1/src/a.js:1:1)"])).toBe("a (/src/a.js)");
  });

  it("works without a usable stack", () => {
    expect(location([])).toBeUndefined();
    expect(location(["second line of a message"])).toBeUndefined();
    expect(key("x")).toBe(key("x", ["map@[native code]"]));
  });

  it("reads a location that is not a URL", () => {
    expect(location(["at a (./src/a.js?x=1:1:1)"])).toBe("a (./src/a.js)");
  });
});
