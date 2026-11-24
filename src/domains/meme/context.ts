import { MessageType, type Attachment, type Message, type MessageManager } from 'discord.js';
import type { MemeImage } from './gemini';

const contextSize = 10;
// Base64 and the text of the request must fit within Gemini's 20 MB inline limit.
const imageBudget = 14 * 1024 * 1024;
const supportedImageTypes = /^image\/(jpeg|png|webp|heic|heif)(?:;|$)/i;
const customEmoji = /<a?:([\w-]+):(\d{17,20})>/g;

function isPhoto(attachment: Attachment) {
    return attachment.contentType ? supportedImageTypes.test(attachment.contentType)
        : /\.(jpe?g|png|webp|heic|heif)$/i.test(attachment.name);
}

export async function recentUserMessages(manager: MessageManager, before: string) {
    const messages: Message[] = [];
    while (messages.length < contextSize) {
        const page = await manager.fetch({ before, limit: contextSize, cache: false });
        for (const message of page.values()) {
            if (!message.author.bot && !message.webhookId
                && (message.type === MessageType.Default || message.type === MessageType.Reply)
                && (message.content.trim() || message.attachments.some(isPhoto))) {
                messages.push(message);
                if (messages.length === contextSize) break;
            }
        }
        const oldest = page.lastKey();
        if (page.size < contextSize || !oldest || oldest === before) break;
        before = oldest;
    }
    return messages.reverse();
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

export async function buildMemeContext(messages: readonly Message[]) {
    const photos: ImageSource[] = [];
    const emojis = new Map<string, ImageSource>();
    const names = new Map<string, Promise<string>>();

    const lines = messages.map(message => {
        const author = message.author;
        const name = names.get(author.id) ?? (async () => {
            const member = message.member ?? await message.guild?.members.fetch({ user: author.id, cache: false }).catch(() => null);
            return (member?.displayName ?? author.displayName).replace(/[\r\n<>]/g, ' ');
        })();
        names.set(author.id, name);
        const text = message.content.trim()
            .replace(/<(?:@!?|@&|#)\d+>/g, '[멘션]')
            .replace(/https?:\/\/[^\s<>]+/gi, '[링크]')
            .replace(customEmoji, (_match, emojiName: string, id: string) => {
                const existing = emojis.get(id);
                if (existing) return `<${existing.label}>`;
                const label = `이모티콘${emojis.size + 1}`;
                emojis.set(id, { label, name: emojiName, url: `https://cdn.discordapp.com/emojis/${id}.webp?size=128` });
                return `<${label}>`;
            });
        const attachments = message.attachments.filter(isPhoto).map(attachment => {
            const label = `사진${photos.length + 1}`;
            photos.push({ label, url: attachment.url, size: attachment.size });
            return `<${label}>`;
        });
        return { name, text: [text, ...attachments].filter(Boolean).join(' ') };
    });

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

    const transcript = (await Promise.all(lines.map(async ({ name, text }) => `<${await name}>: ${text}`))).join('\n');
    return { transcript, images, unavailableImages };
}
