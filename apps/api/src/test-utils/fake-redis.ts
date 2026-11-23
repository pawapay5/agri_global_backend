/** In-memory subset of ioredis used by unit tests. */
export class FakeRedis {
  private store = new Map<string, { v: string; exp: number | null }>();
  now = () => Date.now();

  private live(k: string) {
    const e = this.store.get(k);
    if (!e) return undefined;
    if (e.exp !== null && e.exp <= this.now()) { this.store.delete(k); return undefined; }
    return e;
  }
  async get(k: string) { return this.live(k)?.v ?? null; }
  async set(k: string, v: string, ...args: (string | number)[]) {
    let exp: number | null = null; let nx = false;
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "EX") exp = this.now() + Number(args[++i]) * 1000;
      else if (args[i] === "PX") exp = this.now() + Number(args[++i]);
      else if (args[i] === "NX") nx = true;
    }
    if (nx && this.live(k)) return null;
    this.store.set(k, { v, exp });
    return "OK";
  }
  async del(...ks: string[]) { let n = 0; for (const k of ks) if (this.store.delete(k)) n++; return n; }
  async incr(k: string) {
    const e = this.live(k); const n = Number(e?.v ?? 0) + 1;
    this.store.set(k, { v: String(n), exp: e?.exp ?? null });
    return n;
  }
  async expire(k: string, s: number) { const e = this.live(k); if (!e) return 0; e.exp = this.now() + s * 1000; return 1; }
  async ttl(k: string) { const e = this.live(k); if (!e) return -2; if (e.exp === null) return -1; return Math.ceil((e.exp - this.now()) / 1000); }
  async exists(k: string) { return this.live(k) ? 1 : 0; }
}
