import { MessageType, type Attachment, type Message, type MessageManager } from 'discord.js';
import type { MemeImage } from './gemini';
import { parsePastedMessages } from './pasted';

const contextSize = 10;
// Leave room for five search thumbnails, base64 overhead, and text in Gemini's 20 MB request.
const imageBudget = 13 * 1024 * 1024;
const supportedImageTypes = /^image\/(jpeg|png|webp|heic|heif)(?:;|$)/i;
const customEmoji = /<a?:([\w-]+):(\d{17,20})>/g;
const pastedEmoji = /(?<![\w:<]):([\w-]+):(?![\w:>])/g;
type MemeHistory = { messages: readonly Message[]; pasted?: NonNullable<ReturnType<typeof parsePastedMessages>> };
type MemeTurn = { number: number; speaker: string; text: string; imageLabels: readonly string[]; replyTo?: number };
export type MemeConversation = { turns: readonly MemeTurn[]; sharedImageLabels?: readonly string[] };

function isPhoto(attachment: Attachment) {
    return attachment.contentType ? supportedImageTypes.test(attachment.contentType)
        : /\.(jpe?g|png|webp|heic|heif)$/i.test(attachment.name);
}

export async function recentUserMessages(manager: MessageManager, before: string): Promise<MemeHistory> {
    const messages: Message[] = [];
    while (messages.length < contextSize) {
        const page = await manager.fetch({ before, limit: contextSize, cache: false });
        for (const message of page.values()) {
            if (!message.author.bot && !message.webhookId
                && (message.type === MessageType.Default || message.type === MessageType.Reply)
                && (message.content.trim() || message.attachments.some(isPhoto))) {
                if (!messages.length) {
                    const pasted = parsePastedMessages(message.content);
                    if (pasted) return { messages: [message], pasted: pasted.slice(-contextSize) };
                }
                messages.push(message);
                if (messages.length === contextSize) break;
            }
        }
        const oldest = page.lastKey();
        if (page.size < contextSize || !oldest || oldest === before) break;
        before = oldest;
    }
    return { messages: messages.reverse() };
}

type ImageSource = { label: string; url: string; name?: string; size?: number };

async function downloadImage(url: string, limit: number, signal: AbortSignal) {
    const response = await fetch(url, { signal, redirect: 'error' });
    const mimeType = response.headers.get('content-type')?.split(';')[0]?.toLowerCase() ?? '';
    if (!response.ok || !response.body || !supportedImageTypes.test(mimeType)
        || Number(response.headers.get('content-length')) > limit) {
        await response.body?.cancel();
        return;
    }
    const chunks: Uint8Array[] = [];
    let size = 0;
    for await (const chunk of response.body) {
        size += chunk.byteLength;
        if (size > limit) return;
        chunks.push(chunk);
    }
    if (size) return { mimeType, size, data: Buffer.concat(chunks, size).toString('base64') };
}

export async function buildMemeContext({ messages, pasted }: MemeHistory) {
    const photos: ImageSource[] = [];
    const emojis = new Map<string, ImageSource>();
    const names = new Map<string, Promise<string>>();

    function emojiLabel(name: string, id: string) {
        const existing = emojis.get(id);
        if (existing) return existing.label;
        const label = `이모티콘${emojis.size + 1}`;
        emojis.set(id, { label, name, url: `https://cdn.discordapp.com/emojis/${id}.webp?size=128` });
        return label;
    }

    const photoLabels = (message: Message) => message.attachments.filter(isPhoto).map(attachment => {
        const label = `사진${photos.length + 1}`;
        photos.push({ label, url: attachment.url, size: attachment.size });
        return label;
    });

    const pastedEmojis = pasted?.some(({ text }) => text.search(pastedEmoji) !== -1)
        ? await messages[0]?.guild?.emojis.fetch().catch(() => null) : null;

    function formatTurn(name: string | Promise<string>, content: string, attachments: readonly string[] = []) {
        const imageLabels = new Set(attachments);
        function referenceEmoji(emojiName: string, id: string) {
            const label = emojiLabel(emojiName, id);
            imageLabels.add(label);
            return `<${label}>`;
        }

        let text = content.trim()
            .replace(/<(?:@!?|@&|#)\d+>/g, '[멘션]')
            .replace(/https?:\/\/[^\s<>]+/gi, '[링크]')
            .replace(customEmoji, (_match, emojiName: string, id: string) => referenceEmoji(emojiName, id));
        if (pastedEmojis) {
            text = text.replace(pastedEmoji, (match, emojiName: string) => {
                const matches = pastedEmojis.filter(emoji => emoji.name === emojiName && emoji.available !== false);
                const emoji = matches.size === 1 ? matches.first() : undefined;
                return emoji ? referenceEmoji(emojiName, emoji.id) : match;
            });
        }
        return {
            name, text: [text, ...attachments.map(label => `<${label}>`)].filter(Boolean).join(' '),
            imageLabels: [...imageLabels],
        };
    }

    const lines = pasted ? pasted.map(({ name, text }) => formatTurn(name, text)) : messages.map(message => {
        const author = message.author;
        const name = names.get(author.id) ?? (async () => {
            const member = message.member ?? await message.guild?.members.fetch({ user: author.id, cache: false }).catch(() => null);
            return member?.displayName ?? author.displayName;
        })();
        names.set(author.id, name);
        return formatTurn(name, message.content, photoLabels(message));
    });
    const sharedImageLabels = pasted && messages[0] ? photoLabels(messages[0]) : [];
    const messageNumbers = new Map(messages.map((message, index) => [message.id, index + 1]));

    const images: MemeImage[] = [];
    const unavailableImages: string[] = [];
    const signal = AbortSignal.timeout(8_000);
    let remaining = imageBudget;
    for (const { label, name, url, size } of [...photos.reverse(), ...emojis.values()]) {
        const image = !signal.aborted && remaining && (size ?? 0) <= remaining
            ? await downloadImage(url, remaining, signal).catch(() => undefined) : undefined;
        if (!image) {
            unavailableImages.push(label);
            continue;
        }
        remaining -= image.size;
        images.push({ label, name, mimeType: image.mimeType, data: image.data });
    }

    const turns = await Promise.all(lines.map(async ({ name, text, imageLabels }, index) => {
        const message = pasted ? undefined : messages[index];
        const reference = message?.type === MessageType.Reply ? message.reference?.messageId : undefined;
        const replyTo = reference ? messageNumbers.get(reference) : undefined;
        return {
            number: index + 1, speaker: (await name).replace(/[\r\n<>]/g, ' '), text, imageLabels,
            ...(replyTo && { replyTo }),
        };
    }));
    const transcript = turns.map(({ number, speaker, text, replyTo }) =>
        `#${number}${replyTo ? `(↪#${replyTo})` : ''} <${speaker}>: ${text}`);
    if (sharedImageLabels.length) {
        transcript.unshift(`붙여넣은 메시지의 첨부 ${sharedImageLabels.map(label => `<${label}>`).join(' ')}`);
    }
    const conversation: MemeConversation = { turns, ...(sharedImageLabels.length && { sharedImageLabels }) };
    return { conversation, transcript: transcript.join('\n'), images, unavailableImages };
}
