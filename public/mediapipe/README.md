# Browser-local face landmark assets

`face_landmarker.task` is Google's Face Landmarker float16 model, revision 1, from:
https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task

SHA-256: `64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff`

The `vision_wasm_*` files are copied from `@mediapipe/tasks-vision@1.1.0/wasm`
(Apache-2.0). We ship SIMD and non-SIMD variants for browser compatibility.
The Focus page loads them only after the user presses **Enable camera**. Frames
are processed locally; there is no camera upload endpoint.
