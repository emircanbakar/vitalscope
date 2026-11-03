# @vitalscope/protocol

The event protocol shared by `@vitalscope/sdk` and the Vitalscope ingest service.

- `@vitalscope/protocol`: metric thresholds (`getRating`), limits, privacy scrubbing (`scrubText`, `scrubPath`) and TypeScript types. It does not load Zod at runtime.
- `@vitalscope/protocol/schema`: Zod schemas for validating batches on the server.

The protocol is versioned (`v` in every batch). A breaking change bumps the major version of this package and `PROTOCOL_VERSION`.

Every version is published from GitHub Actions with npm provenance. Check it with `npm audit signatures`.
