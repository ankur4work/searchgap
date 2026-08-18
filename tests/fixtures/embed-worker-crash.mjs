// Test fixture: an embed worker that dies at its top-level import, exactly as
// the real one does when the model download fails or the native ONNX binding
// won't load. Exits with code 1 and NO signal — the case that used to hang.
throw new Error('simulated top-level import failure');
