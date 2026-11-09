/** Saves text as a calendar file with a temporary link. */
export function downloadFile(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/calendar;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Some browsers start the save a moment after the click, so the address is freed later.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
