// W6 F — network policy: default-deny egress.
//
// TWO LAYERS, AND THE STRONGER ONE IS THE DEFAULT
//
// The container backend runs with `--network none`, which is not a filter but the absence of a
// network stack: there is no interface to send from. That is strictly stronger than any blocklist
// and it is the shipped default, so the common case needs no policy evaluation at all.
//
// This module is the SECOND layer, for when a run legitimately needs egress (installing
// dependencies, calling an API the task is about). Then "default deny" has to mean something
// precise, and two rules matter more than the rest:
//
//   1. Nothing is reachable unless it was explicitly allowed. An allowlist, never a blocklist —
//      a blocklist of bad destinations is a promise to have thought of all of them.
//   2. Some destinations stay blocked even when a grant says otherwise. Cloud instance metadata
//      is reachable from inside almost every hosted environment, requires no credentials, and
//      hands out real ones. An agent that can be talked into fetching 169.254.169.254 has
//      exfiltrated the host's identity, and no per-domain approval should be able to authorise
//      that — so the check is not overridable by the grant store (W6-M).
//
// Shape follows QM's `BlockList` (verified at source during the audit): deny by default, with
// link-local and metadata ranges hard-blocked.

/**
 * Destinations that are NEVER reachable, whatever the policy or the grants say.
 *
 * These are not "sensitive hosts" in a general sense — each is an address that leaks the identity
 * or control plane of the machine the agent happens to be running on.
 */
export const HARD_BLOCKED = Object.freeze([
  // IPv4 link-local, which contains every cloud provider's metadata endpoint.
  { cidr: '169.254.0.0/16', why: 'IPv4 link-local — contains cloud instance metadata (SSRF to credentials)' },
  // The canonical metadata address, named separately so the denial reason is legible.
  { cidr: '169.254.169.254/32', why: 'cloud instance metadata service — hands out host credentials' },
  // GCP/Alibaba resolve metadata by name too, so an allowlist entry must not smuggle it in.
  { host: 'metadata.google.internal', why: 'GCP metadata by name' },
  { host: 'metadata.goog', why: 'GCP metadata by name' },
  { host: 'instance-data', why: 'EC2 metadata by name' },
  // IPv6 link-local.
  { cidr: 'fe80::/10', why: 'IPv6 link-local' },
  // Loopback is blocked from inside a sandbox: it is the HOST's loopback that the escape wants,
  // and a sandboxed process has no legitimate reason to reach a service on the host by localhost.
  { cidr: '127.0.0.0/8', why: 'host loopback — a sandboxed process must not reach host services' },
  { cidr: '::1/128', why: 'host loopback (IPv6)' },
]);

/** Parse an IPv4 dotted quad into a 32-bit integer, or null when it is not one. */
function ipv4ToInt(s) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(String(s ?? ''));
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  if (parts.some(n => n > 255)) return null;
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

/** Is `ip` inside `cidr`? IPv4 only; IPv6 is matched by prefix string below. */
function ipv4InCidr(ip, cidr) {
  const [net, bitsRaw] = String(cidr).split('/');
  const bits = Number(bitsRaw);
  const a = ipv4ToInt(ip), b = ipv4ToInt(net);
  if (a === null || b === null || !Number.isInteger(bits)) return false;
  if (bits === 0) return true;
  const mask = (0xffffffff << (32 - bits)) >>> 0;
  return (a & mask) === (b & mask);
}

/**
 * Is this destination hard-blocked? Returns the reason, or null when it is not.
 *
 * Matched on both name and literal address, because the name is what a URL carries and the
 * address is what it resolves to — checking only one of them is checking neither.
 */
export function hardBlockReason(destination) {
  const d = String(destination ?? '').trim().toLowerCase()
    // tolerate a URL, a host:port, or a bare host
    .replace(/^[a-z]+:\/\//, '').replace(/\/.*$/, '').replace(/:\d+$/, '')
    .replace(/^\[|\]$/g, '');
  if (!d) return 'empty destination';

  for (const rule of HARD_BLOCKED) {
    if (rule.host && d === rule.host) return rule.why;
    if (rule.cidr) {
      if (rule.cidr.includes(':')) {
        // IPv6: prefix compare on the textual form. Enough for the link-local and loopback
        // rules here; a full IPv6 CIDR matcher is not needed to state that fe80:: is blocked.
        const p = rule.cidr.split('/')[0].replace(/::$/, '');
        if (d === '::1' && rule.cidr === '::1/128') return rule.why;
        if (p && d.startsWith(p.slice(0, 4))) return rule.why;
      } else if (ipv4InCidr(d, rule.cidr)) {
        return rule.why;
      }
    }
  }
  return null;
}

/**
 * A network policy. `mode: 'none'` is the shipped default and means exactly that — no network.
 *
 * @param {{ mode?: 'none'|'deny'|'allowlist', allow?: string[] }} [opts]
 */
export function createNetworkPolicy({ mode = 'none', allow = [] } = {}) {
  const allowed = new Set(allow.map(s => String(s).trim().toLowerCase()).filter(Boolean));

  return Object.freeze({
    mode,
    /** The destinations explicitly permitted. Empty under 'none' and 'deny'. */
    allowed: Object.freeze([...allowed]),

    /**
     * @returns {{allowed: boolean, reason: string}}
     */
    check(destination) {
      // Hard blocks come FIRST, before mode and before any allowlist. This ordering is the
      // whole guarantee: a grant, an operator override or a permissive mode cannot reach past it.
      const hard = hardBlockReason(destination);
      if (hard) return { allowed: false, reason: `hard-blocked: ${hard}` };

      if (mode === 'none') return { allowed: false, reason: 'no network: the sandbox has no network stack' };
      if (mode === 'deny') return { allowed: false, reason: 'default-deny: no egress allowed' };

      const d = String(destination ?? '').trim().toLowerCase()
        .replace(/^[a-z]+:\/\//, '').replace(/\/.*$/, '').replace(/:\d+$/, '');
      if (allowed.has(d)) return { allowed: true, reason: `explicitly allowed: ${d}` };
      // Subdomain match, but only for an entry written as a suffix, so `example.com` does not
      // silently authorise `notexample.com`.
      for (const a of allowed) {
        if (a.startsWith('.') && (d === a.slice(1) || d.endsWith(a)))
          return { allowed: true, reason: `allowed by suffix ${a}` };
      }
      return { allowed: false, reason: `not on the allowlist (default deny): ${d}` };
    },
  });
}

/**
 * Modes the CONTAINER BACKEND can actually enforce.
 *
 * W6.1 PROOF 3 measured what the other mode really did, and the answer was: nothing. `allowlist`
 * returned no docker flags, so the container got the runtime's default bridge — full, unfiltered
 * egress — while `capabilities.network` reported `'restricted'`. Measured live: with a policy
 * allowing only `registry.npmjs.org`, both `example.com` and the raw IP `1.1.1.1` were reachable.
 * Nothing anywhere called `policy.check()`, so the allowlist was a data structure no code asked.
 *
 * That is a capability LIE, which the backend contract treats as a security bug rather than a
 * documentation one — a declaration is what posture and operator trust are built on.
 *
 * The honest fix is to fail closed. Enforcing a per-domain allowlist needs a mechanism this
 * runtime does not have (an egress proxy on an `--internal` network, or in-container firewall
 * rules requiring NET_ADMIN); until one exists, a mode that cannot restrict must not be offered
 * as though it can. Silently handing a run the whole internet because the operator asked for a
 * narrow allowlist is the exact exfiltration route the policy was meant to close.
 */
export const ENFORCEABLE_MODES = Object.freeze(new Set(['none', 'deny']));

/**
 * The docker/podman flags for a policy.
 *
 * Throws for a mode the backend cannot enforce, rather than returning `[]` and letting the caller
 * start an unrestricted container. `policy.check()` remains correct and exported for a deployer
 * implementing enforcement elsewhere — it is the decision function, not the mechanism.
 */
export function networkFlagsFor(policy) {
  // 'deny' still gets `--network none`: a policy that denies everything and a sandbox with no
  // stack are the same reachability, and the stronger mechanism is free.
  if (!policy || ENFORCEABLE_MODES.has(policy.mode)) return ['--network', 'none'];
  throw new Error(
    `network policy mode '${policy.mode}' cannot be enforced by the container backend. `
    + `Per-domain egress filtering is not implemented: the container would receive the runtime's `
    + `default bridge and unrestricted egress while declaring itself restricted. `
    + `Use mode 'none' (the shipped default) or 'deny'.`);
}
