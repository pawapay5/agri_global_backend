/** CIDR allow-list (IPv4 and IPv6) for the admin console, from ADMIN_IP_ALLOWLIST="203.0.113.0/24, 2001:db8::/32". */

function v4(ip: string): bigint | null {
  const p = ip.split(".");
  if (p.length !== 4) return null;
  let n = 0n;
  for (const x of p) {
    if (!/^\d{1,3}$/.test(x) || Number(x) > 255) return null;
    n = (n << 8n) | BigInt(Number(x));
  }
  return n;
}

function v6(ip: string): bigint | null {
  let s = ip.toLowerCase().split("%")[0]!;
  const tail = s.match(/(\d+\.\d+\.\d+\.\d+)$/); // IPv4-mapped tail, e.g. ::ffff:1.2.3.4
  if (tail) {
    const n = v4(tail[1]!);
    if (n == null) return null;
    s = s.slice(0, -tail[1]!.length) + `${(n >> 16n).toString(16)}:${(n & 0xffffn).toString(16)}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves.length === 2 ? (halves[1] ? halves[1].split(":") : []) : [];
  const fill = halves.length === 2 ? 8 - head.length - rest.length : 0;
  if (fill < 0) return null;
  const groups = [...head, ...Array(fill).fill("0"), ...rest];
  if (groups.length !== 8) return null;
  let n = 0n;
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    n = (n << 16n) | BigInt(parseInt(g, 16));
  }
  return n;
}

type Range = { family: 4 | 6; base: bigint; bits: number };

function parse(ip: string): { family: 4 | 6; n: bigint } | null {
  const a = v4(ip);
  if (a != null) return { family: 4, n: a };
  const b = v6(ip);
  if (b == null) return null;
  // Treat IPv4-mapped IPv6 (::ffff:a.b.c.d) as IPv4.
  if (b >> 32n === 0xffffn) return { family: 4, n: b & 0xffffffffn };
  return { family: 6, n: b };
}

export function parseAllowlist(spec: string | undefined): Range[] {
  return (spec ?? "").split(/[\s,]+/).filter(Boolean).flatMap((entry) => {
    const [ip, len] = entry.split("/");
    const p = parse(ip ?? "");
    if (!p) return [];
    const max = p.family === 4 ? 32 : 128;
    const bits = len === undefined ? max : Number(len);
    if (!Number.isInteger(bits) || bits < 0 || bits > max) return [];
    return [{ family: p.family, base: p.n >> BigInt(max - bits), bits }];
  });
}

/** True when the list is empty (feature off) or the IP falls in one of the ranges. */
export function ipAllowed(ip: string | null, ranges: Range[]): boolean {
  if (!ranges.length) return true;
  const p = ip ? parse(ip) : null;
  if (!p) return false;
  const max = p.family === 4 ? 32 : 128;
  return ranges.some((r) => r.family === p.family && p.n >> BigInt(max - r.bits) === r.base);
}
