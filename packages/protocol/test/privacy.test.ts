import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { REDACTED, scrubPath, scrubText } from "../src/privacy.js";

const JWT_SAMPLE =
  "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";

describe("scrubText", () => {
  it.each([
    ["Cannot load user a.b+c@example.co.uk", `Cannot load user ${REDACTED}`],
    [`Invalid token ${JWT_SAMPLE}`, `Invalid token ${REDACTED}`],
    ["401 for Authorization: Bearer abc.DEF-123_xyz==", `401 for Authorization: ${REDACTED}`],
    ["Card 4111111111111111 declined", `Card ${REDACTED} declined`],
    ["GET https://api.test/v1?user=7&token=s3cr3t&lang=tr failed", `GET https://api.test/v1?user=7&token=${REDACTED}&lang=tr failed`],
    ["at f (https://x.test/app.js?api_key=AbC123:1:20)", `at f (https://x.test/app.js?api_key=${REDACTED}`],
  ])("redacts %s", (input, expected) => {
    expect(scrubText(input)).toBe(expected);
  });

  it("keeps ordinary messages and short numbers", () => {
    const msg = "TypeError: Cannot read properties of undefined (reading 'price') at line 42";
    expect(scrubText(msg)).toBe(msg);
  });
});

describe("scrubPath", () => {
  it.each([
    ["/kullanici/a@b.com/ayarlar", "/kullanici/[email]/ayarlar"],
    ["/siparis/550e8400-e29b-41d4-a716-446655440000", "/siparis/[uuid]"],
    ["/tel/05321234567", "/tel/[number]"],
    ["/urun/123", "/urun/123"],
  ])("%s → %s", (input, expected) => {
    expect(scrubPath(input)).toBe(expected);
  });
});

// Property testleri: rastgele metinlerin arasına gizli veri gömülür, çıktıda hiçbiri kalmamalı.
const filler = fc.string({ maxLength: 40 });
const secret = fc.oneof(
  fc.emailAddress(),
  fc.constant(JWT_SAMPLE),
  fc.stringMatching(/^eyJ[A-Za-z0-9_-]{8,40}$/),
  fc.stringMatching(/^[A-Za-z0-9._~+/-]{8,40}$/).map((t) => `Bearer ${t}`),
  fc.stringMatching(/^[0-9]{13,19}$/),
  fc.stringMatching(/^[A-Za-z0-9]{4,30}$/).map((v) => `?token=${v}`),
);
const textWithSecret = fc.tuple(filler, secret, filler).map(([a, s, b]) => ({ text: `${a} ${s} ${b}`, s }));

const LEAK_PATTERNS = [
  /@[\w-]+(?:\.[\w-]+)*\.[a-z]{2,}/i,
  /eyJ[\w-]{4,}/,
  /Bearer\s+[\w.~+/-]{8,}/i,
  /\d{13,}/,
  /token=(?!\[redacted\])[^&#\s'"]+/i,
];

describe("scrubbing properties", () => {
  it("never leaves an email, token or long number in text", () => {
    fc.assert(
      fc.property(textWithSecret, ({ text }) => {
        const out = scrubText(text);
        for (const pattern of LEAK_PATTERNS) expect(out).not.toMatch(pattern);
      }),
      { numRuns: 500 },
    );
  });

  it("is idempotent", () => {
    fc.assert(
      fc.property(fc.oneof(textWithSecret.map((t) => t.text), fc.string()), (text) => {
        const once = scrubText(text);
        expect(scrubText(once)).toBe(once);
      }),
      { numRuns: 500 },
    );
  });

  it("never leaves an email or long number in a path", () => {
    const pathWithSecret = fc
      .tuple(fc.stringMatching(/^[a-z/]{0,20}$/), fc.oneof(fc.emailAddress(), fc.stringMatching(/^[0-9]{9,19}$/)))
      .map(([a, s]) => `/${a}/${s}`);
    fc.assert(
      fc.property(pathWithSecret, (path) => {
        const out = scrubPath(path);
        expect(out).not.toMatch(/@/);
        expect(out).not.toMatch(/\d{9,}/);
      }),
      { numRuns: 500 },
    );
  });
});
