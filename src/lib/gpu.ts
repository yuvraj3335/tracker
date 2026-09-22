/**
 * Whether the speech model can run on this machine's GPU, and whether it
 * should.
 *
 * The WASM build generates speech slightly slower than the speech is spoken,
 * which is the whole reason there is still a pause after a full stop. A GPU
 * does the same arithmetic many times faster, and — the part that makes it
 * worth doing at all — it wants exactly the same half-precision file the WASM
 * path already downloads. So on a machine that qualifies this costs no extra
 * bytes and no extra download; it is the same model, run somewhere better.
 *
 * "Qualifies" is the careful part, and it is deliberately narrow. Nothing here
 * has been run on a discrete GPU — this machine has no adapter beyond a
 * software one — so the rule is written to refuse anything it cannot reason
 * about, and the worker measures what it actually got before keeping it.
 *
 * Pure, and taking a plain object, so the rule can be tested without a GPU.
 */
export type AdapterHints = {
  vendor?: string;
  architecture?: string;
  description?: string;
  /** The browser is emulating a GPU in software and says so. */
  isFallbackAdapter?: boolean;
  /** Half-precision arithmetic in shaders. Without it there is no fp16 build. */
  shaderF16?: boolean;
};

/**
 * The names browsers use for "there is no GPU here, I am pretending".
 *
 * A software adapter runs the same shaders on the CPU, through an extra
 * translation layer, and is reliably *slower* than the WASM build it would be
 * replacing. It has to be excluded by name as well as by `isFallbackAdapter`,
 * because a browser launched with software rendering forced on reports a
 * perfectly ordinary-looking adapter that is not one.
 */
const SOFTWARE = /swiftshader|llvmpipe|softpipe|lavapipe|software|basic render|warp\b/i;

export function shouldUseGPU(hints: AdapterHints | null | undefined): boolean {
  if (!hints) return false;
  if (hints.isFallbackAdapter) return false;
  // No half precision, no fp16 build — and the full-precision one is 310 MB,
  // which is not a download to make on anyone's behalf. transformers.js
  // refuses this combination itself, so this only saves the attempt.
  if (!hints.shaderF16) return false;
  const name = `${hints.vendor ?? ''} ${hints.architecture ?? ''} ${hints.description ?? ''}`;
  return !SOFTWARE.test(name);
}

type GPUish = {
  requestAdapter(options?: { powerPreference?: string }): Promise<{
    info?: { vendor?: string; architecture?: string; description?: string };
    isFallbackAdapter?: boolean;
    features: { has(name: string): boolean };
  } | null>;
};

/** What this machine will admit about its GPU. Null when there is none. */
export async function adapterHints(): Promise<AdapterHints | null> {
  const gpu = (globalThis.navigator as Navigator & { gpu?: GPUish } | undefined)?.gpu;
  if (!gpu) return null;
  try {
    const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) return null;
    const info = adapter.info ?? {};
    return {
      vendor: info.vendor,
      architecture: info.architecture,
      description: info.description,
      isFallbackAdapter: adapter.isFallbackAdapter,
      shaderF16: adapter.features.has('shader-f16'),
    };
  } catch {
    return null;
  }
}
