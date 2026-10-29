const call = async (path, opts = {}) => {
  const r = await fetch("/api" + path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
};
export const api = {
  screeners: (tab, q = "") => call(`/screeners?tab=${tab}&q=${encodeURIComponent(q)}`),
  create: (body) => call("/screeners", { method: "POST", body: JSON.stringify(body) }),
  act: (id, action) => call(`/screeners/${id}/${action}`, { method: "POST" }),
  run: (id) => call(`/screeners/${id}/run`),
  scan: (q) => call(`/scan?q=${encodeURIComponent(q)}`),
  live: () => call("/live-scanner"),
  insights: () => call("/insights"),
};