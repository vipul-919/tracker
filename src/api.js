export async function api(path, options = {}) {
  let response;
  try { response = await fetch(`/api${path}`, { ...options, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'Tempo', ...options.headers }, credentials: 'same-origin' }); }
  catch { throw new Error('Cannot reach the server. Check your connection and try again.'); }
  const data = await response.json().catch(() => ({ error: 'Server unavailable. Make sure the API and MongoDB are running.' }));
  if (!response.ok) throw Object.assign(new Error(data.error || 'Request failed'), { status: response.status });
  return data;
}
export function download(path) { const a = document.createElement('a'); a.href = `/api${path}`; a.download = ''; a.click(); }
