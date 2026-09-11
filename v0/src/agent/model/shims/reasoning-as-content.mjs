// PROVIDER SHIM — reasoning-as-content for providers that route all output to `reasoning`.
//
// WHY THIS EXISTS (do not move this into the core):
// gpt-oss-120b (Groq) returns a `reasoning` field in the wire response and leaves `content`
// empty. The harness reads `msg.content ?? ''` → empty string, so the model appears silent
// even when it has produced tool calls or thinking.  This shim remaps `ext.reasoning → content`
// when content is empty, making the model's output visible to the trajectory.
//
// This shim is OPT-IN and never runs unless a caller asks for it via ORION_SHIMS or
// selectShims auto-detection.

/**
 * Apply the shim to a normalised ModelResult.
 * No-ops when content is already present or reasoning is absent.
 */
export function applyReasoningAsContent(result) {
  if (result.content) return result;
  const reasoning = result.ext?.reasoning;
  if (reasoning == null) return result;
  const text = typeof reasoning === 'string' ? reasoning
    : typeof reasoning === 'object' ? JSON.stringify(reasoning) : '';
  if (!text) return result;
  return { ...result, content: text,
           ext: { ...result.ext, shimmed: 'reasoning-as-content' } };
}
