export async function api(path, options = {}) {
  let response;
  try { response = await fetch(`/api${path}`, { ...options, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'Tempo', ...options.headers }, credentials: 'same-origin' }); }
  catch { throw new Error('Cannot reach the server. Check your connection and try again.'); }
  const data = await response.json().catch(() => ({ error: 'Server unavailable. Make sure the API and MongoDB are running.' }));
  if (!response.ok) throw Object.assign(new Error(data.error || 'Request failed'), { status: response.status });
  return data;
}
export async function download(path) {
  try {
    const response = await fetch(`/api${path}`, { credentials: 'same-origin', headers: { 'X-Requested-With': 'Tempo' } });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || 'The export could not be downloaded. Please try again.');
    }
    const disposition = response.headers.get('content-disposition') || '';
    const encodedFilename = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
    const plainFilename = disposition.match(/filename="?([^";]+)"?/i)?.[1];
    const filename = encodedFilename ? decodeURIComponent(encodedFilename) : plainFilename || 'tempo-work-report';
    const objectUrl = URL.createObjectURL(await response.blob());
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = filename;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The export could not be downloaded. Please try again.';
    window.dispatchEvent(new CustomEvent('tempo-download-error', { detail: message }));
    return false;
  }
}
