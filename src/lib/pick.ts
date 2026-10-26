/** Opens the browser's file picker. Resolves to null when the person cancels. */
export function pickFile(extensions: string[]): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = extensions.map((e) => "." + e).join(",");
    input.style.display = "none";
    let done = false;
    const finish = (f: File | null) => { if (!done) { done = true; input.remove(); resolve(f); } };
    input.onchange = () => finish(input.files?.[0] || null);
    input.oncancel = () => finish(null);
    document.body.appendChild(input);
    input.click();
  });
}
export function saveText(name: string, text: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
