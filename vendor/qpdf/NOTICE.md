# QPDF WASM distribution

`qpdf.js` and `qpdf.wasm` are unmodified copies from npm package `@neslinesli93/qpdf-wasm@0.3.1`. Tests compare their bytes with the pinned package. The CLI reports QPDF 12.2.0.

- Wrapper source/build: <https://github.com/neslinesli93/qpdf-wasm>. ISC: [LICENSE-wrapper.txt](LICENSE-wrapper.txt).
- QPDF 12.2.0: copyright (c) 2005–2021 Jay Berkenbilt; copyright (c) 2022–2025 Jay Berkenbilt and Manfred Holger. [Apache-2.0](LICENSE-APACHE-2.0.txt).
- zlib source commit `21767c654d31d2dccdde4330529775c6c5fd5389`: [original README/license](LICENSE-zlib-README.txt).
- jpeg-turbo source commit `7aa2a898c564041a24b09d0a6e780aaa632d08d3`: [licenses](LICENSE-jpeg-turbo.md), [README.ijg](README.ijg).

This software is based in part on the work of the Independent JPEG Group.

The upstream Dockerfile pins QPDF source `856d32c610334855d30e96d25eb5f9636fb62f08` and Emscripten 3.1.74. Binaries came from npm and were not rebuilt here. The app requests structural normalization, not lossy recompression or page rasterization.
