// Test fixture: an embed worker that starts cleanly, registers nothing, and
// exits 0 without ever replying. Distinct from a crash — the parent must still
// settle rather than wait for a message that will never come.
process.exit(0);
