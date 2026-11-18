// Stellt der Seite dieselbe Schnittstelle bereit wie im claude.ai-Viewer: window.claude.use("sample").
// Die Anfrage läuft über den Hauptprozess mit dem eigenen API-Schlüssel des Nutzers.
(function () {
  const N = window.kaderlaborNative;
  if (!N || window.claude) return;

  const toBase64 = (blob) => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] || "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });

  function parseJsonTolerant(text) {
    try { return JSON.parse(text); } catch (e) { /* weiter */ }
    const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) { try { return JSON.parse(fence[1]); } catch (e) { /* weiter */ } }
    const a = text.search(/[\[{]/), b = Math.max(text.lastIndexOf("]"), text.lastIndexOf("}"));
    if (a >= 0 && b > a) { try { return JSON.parse(text.slice(a, b + 1)); } catch (e) { /* weiter */ } }
    throw { code: "invalid_json", message: "Antwort war kein JSON.", text };
  }

  async function call(input, opts, json) {
    opts = opts || {};
    if (opts.signal && opts.signal.aborted) throw { code: "cancelled", message: "Abgebrochen." };
    let images = [];
    if (opts.images) {
      const list = opts.images instanceof Blob ? [opts.images] : Array.from(opts.images);
      images = await Promise.all(list.slice(0, 10).map(async (b) => ({ media_type: b.type || "image/png", data: await toBase64(b) })));
    }
    const req = N.sample({ input, images, json, effort: opts.modelTier === "quick" ? "low" : opts.modelTier === "complex" ? "high" : "medium" });
    const res = await (opts.signal
      ? Promise.race([req, new Promise((_, rej) => opts.signal.addEventListener("abort", () => rej({ code: "cancelled", message: "Abgebrochen." }), { once: true }))])
      : req);
    if (!res.ok) {
      // Fehlermeldung zusätzlich sichtbar machen, da die Seite unbekannte Codes allgemein beschreibt
      throw { code: res.code === "auth" ? "upstream_error" : res.code, message: res.message, text: res.code === "auth" ? res.message : undefined };
    }
    if (typeof opts.onText === "function") { try { opts.onText({ text: res.text, delta: res.text }); } catch (e) { console.error(e); } }
    return res;
  }

  const sample = async (input, opts) => {
    const r = await call(input, opts, false);
    return { text: r.text, truncated: !!r.truncated, modelTierApplied: "default" };
  };
  sample.json = async (input, opts) => {
    const r = await call(input, opts, true);
    return parseJsonTolerant(r.text);
  };
  sample.limits = async () => ({
    maxPromptBytes: 262144,
    images: { maxCount: 10, maxInputBytes: 20 * 1024 * 1024, mediaTypes: ["image/png", "image/jpeg", "image/webp", "image/gif"] },
  });

  window.claude = {
    use: async (name) => {
      if (name !== "sample") return null;
      try { return (await N.hasKey()) ? sample : null; } catch (e) { return null; }
    },
  };
})();
