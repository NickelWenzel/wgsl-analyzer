// Emscripten JS library for the wasm LSP transport.
// Linked in via -Clink-arg=--js-library=.../wa-io.js
//
// `__proxy: 'async'` makes emscripten run the body on the *main runtime thread*
// (the top-level thread of the Web Worker hosting the module) even though the
// caller is the Rust writer pthread. That matters because only that thread has
// the worker's `postMessage` to the page, and because it must never block.

addToLibrary({
  // main() starts asynchronously under -sPROXY_TO_PTHREAD, so callMain() returns
  // long before the server can accept messages. The host waits for this.
  wa_ready__proxy: 'async',
  wa_ready__sig: 'v',
  wa_ready: () => {
    Module['onWgslAnalyzerReady']?.();
  },

  // MUST be 'sync', not 'async': the argument is a pointer into the caller's
  // CString, which is dropped as soon as the Rust writer thread returns. With
  // async proxying the main thread reads it after the free and sees an empty
  // string. Sync proxying blocks the writer thread until the copy is made, which
  // is harmless — it is a dedicated thread and the main runtime thread only runs
  // the event loop.
  wa_emit__proxy: 'sync',
  wa_emit__sig: 'vp',
  wa_emit__deps: ['$UTF8ToString'],
  wa_emit: (ptr) => {
    const text = UTF8ToString(ptr);
    let msg;
    try {
      msg = JSON.parse(text);
    } catch (e) {
      console.error('[wgsl-analyzer] wa_emit: bad JSON', e, text.slice(0, 400));
      return;
    }
    // Hediet's monaco-lsp-client transport expects structured-cloned objects,
    // not LSP-framed strings.
    postMessage(msg);
  },
});
