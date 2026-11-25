const copiedHeader = /^(.+?)\s+[—–-]\s+(?:오늘|어제|\d{4}년\s*\d{1,2}월\s*\d{1,2}일|\d{4}\.\s*\d{1,2}\.\s*\d{1,2}\.)\s+(?:(?:오전|오후)\s+)?(?:[01]?\d|2[0-3]):[0-5]\d$/;

export function parsePastedMessages(content: string) {
    const text = content.trim();
    const block = /^```(?:text|txt)?[ \t]*\r?\n([\s\S]*)\r?\n```$/.exec(text)?.[1] ?? text;
    const lines = block.trim().split(/\r?\n/);
    const stripBreak = lines[0]?.trimEnd().endsWith('\\') ?? false;
    const messages: { name: string; lines: string[] }[] = [];

    for (const rawLine of lines) {
        const line = stripBreak ? rawLine.replace(/\\[ \t]*$/, '') : rawLine;
        const name = copiedHeader.exec(line.trim())?.[1];
        if (name) {
            messages.push({ name, lines: [] });
        } else {
            const current = messages.at(-1);
            if (!current) return null;
            current.lines.push(line);
        }
    }

    const turns = messages.map(({ name, lines }) => ({ name, text: lines.join('\n').trim() }));
    return turns.length > 1 && turns.every(turn => turn.text) ? turns : null;
}
