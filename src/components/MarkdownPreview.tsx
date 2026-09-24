import type { ReactNode } from "react";

/** Minimal Markdown renderer for the summary template. Builds React nodes only — never injects HTML. */
function inline(s: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*(.+?)\*\*|\*(.+?)\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(s.slice(last, m.index));
    out.push(m[1] != null ? <strong key={`${key}-${i++}`}>{m[1]}</strong> : <em key={`${key}-${i++}`}>{m[2]}</em>);
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}

export function MarkdownPreview({ markdown }: { markdown: string }) {
  const lines = markdown.split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let k = 0;
  const list = (items: string[], key: string) => (
    <ul key={key} className="my-2 list-disc space-y-1 pl-6">
      {items.map((t, j) => <li key={j} className="break-words">{inline(t, `${key}-${j}`)}</li>)}
    </ul>
  );
  while (i < lines.length) {
    const line = lines[i]!;
    const key = `b${k++}`;
    if (line.startsWith("### ")) blocks.push(<h3 key={key} className="mt-5 text-base font-semibold text-foreground">{inline(line.slice(4), key)}</h3>);
    else if (line.startsWith("## ")) blocks.push(<h2 key={key} className="mt-7 border-b border-border pb-1 text-lg font-semibold text-foreground">{inline(line.slice(3), key)}</h2>);
    else if (line.startsWith("# ")) blocks.push(<h1 key={key} className="text-xl font-semibold text-foreground">{inline(line.slice(2), key)}</h1>);
    else if (line === "---") blocks.push(<hr key={key} className="my-6 border-border" />);
    else if (line.startsWith(">")) {
      const q: string[] = [];
      while (i < lines.length && lines[i]!.startsWith(">")) q.push(lines[i++]!.replace(/^> ?/, ""));
      i--;
      const bullets = q.every((l) => l.startsWith("- "));
      blocks.push(
        <blockquote key={key} className="my-2 border-l-4 border-border bg-secondary/50 px-4 py-2 text-sm text-foreground">
          {bullets ? list(q.map((l) => l.slice(2)), `${key}-l`) : q.map((l, j) => <p key={j} className="whitespace-pre-wrap break-words">{inline(l, `${key}-${j}`)}</p>)}
        </blockquote>,
      );
    } else if (line.startsWith("- ")) {
      const items: string[] = [];
      while (i < lines.length && lines[i]!.startsWith("- ")) items.push(lines[i++]!.slice(2));
      i--;
      blocks.push(list(items, key));
    } else if (line.trim()) blocks.push(<p key={key} className="my-1 whitespace-pre-wrap break-words text-sm text-foreground">{inline(line, key)}</p>);
    i++;
  }
  return <div className="min-w-0">{blocks}</div>;
}
