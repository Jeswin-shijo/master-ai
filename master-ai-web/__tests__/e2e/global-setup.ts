/** Fail fast, with the fix, when the app isn't running. */
export default async function globalSetup() {
  const api = process.env.E2E_API_URL ?? 'http://localhost:3000';
  const web = process.env.E2E_WEB_URL ?? 'http://localhost:5173';
  for (const [name, url] of [
    ['API', `${api}/health`],
    ['web app', web],
  ] as const) {
    const ok = await fetch(url).then(
      (r) => r.ok,
      () => false,
    );
    if (!ok) throw new Error(`The ${name} is not answering at ${url}. Start everything with \`pnpm dev\` first.`);
  }
}
