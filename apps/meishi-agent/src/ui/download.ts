// Saving files (web): a browser download. Native builds use download.native.ts (OS share sheet).
export async function downloadText(text: string, filename: string, type = 'text/plain;charset=utf-8'): Promise<void> {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
