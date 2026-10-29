# Superseded proof file

`moonwell-level2-fKqHGIIi2_.json` is the original Level 2 Moonwell proof from D04-04 (2026-10-27), kept byte for byte
as recorded. It was renamed from `../moonwell-level2-fKqHGIIi2_.atlas.json` on 2026-10-29 (batch R2, review round 1).

**It does not verify, and it is not meant to.** It was made before two checks that `verify` added later:
- the false-alarm table a Level 2 file must carry (S3, days 3-4 review);
- captions decided from the findings: it does not record the Investigator's places, so its "pointed elsewhere"
  caption cannot be checked (M7, same review).

Its replacement, made by a real round with the current code, is `../moonwell-level2-mwTaxvHFzB.atlas.json`, which
verifies. The new name (no `.atlas.json`) keeps it out of the test that verifies every committed proof file
(`tests/unit/r2-review1.test.ts`). The tests and probes that read it as a historic run point here now.
