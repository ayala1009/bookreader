# Vendored OpenCV.js

- Package: `@techstark/opencv-js@4.10.0-release.1`
- Runtime build: OpenCV 4.10.0 (verified via `getBuildInformation()`).
- Downloaded from: https://registry.npmjs.org/@techstark/opencv-js/-/opencv-js-4.10.0-release.1.tgz
- Package homepage: https://github.com/TechStark/opencv-js
- `opencv.js`: unmodified `package/dist/opencv.js`, 10,378,215 bytes.
- SHA-256: `19b46167b59efbef9cc3836264b0b657110833e4b1df84282004b8b3141c048d`
- WebAssembly is embedded as a base64 data URI in `opencv.js`; no external WASM, worker or data file is required by this build.
- `LICENSE` and `package.json` are copied from the package. Keep them with the dependency.

Upload this entire directory without changing filename case. Runtime requests use a path relative to `opencv-loader.js`, e.g. `/bookreader/vendor/opencv/opencv.js`; no CDN is used at runtime.

The previous `https://docs.opencv.org/4.10.0/opencv.js` URL returned HTTP 404 when checked. This package was obtained from the pinned npm release instead.
