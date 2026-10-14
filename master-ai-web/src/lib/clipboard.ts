/**
 * Copy text to the clipboard. Browsers hide the Clipboard API on plain-http
 * addresses and can refuse it; then a hidden text area and the older copy
 * command do the job. False when nothing could copy.
 */
export async function copyText(text: string, doc: Document = document, nav: Navigator = navigator): Promise<boolean> {
  try {
    if (nav.clipboard) {
      await nav.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Refused: try the older way.
  }
  const area = doc.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  Object.assign(area.style, { position: 'fixed', top: '0', left: '0', opacity: '0' });
  doc.body.appendChild(area);
  area.select();
  try {
    return doc.execCommand('copy');
  } catch {
    return false;
  } finally {
    area.remove();
  }
}
