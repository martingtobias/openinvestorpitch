export default {
	async fetch(request, env) {
		const url = new URL(request.url);
		if (url.pathname === "/api/health") {
			const row = await env.DB.prepare("SELECT 1 AS ok").first();
			return Response.json({ ok: row?.ok === 1 });
		}
		return env.ASSETS.fetch(request);
	},
};
