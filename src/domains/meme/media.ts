import { lookup } from 'node:dns';
import { get } from 'node:https';
import { BlockList, isIP } from 'node:net';
import type { IncomingMessage } from 'node:http';

const privateAddresses = new BlockList();
for (const [network, prefix] of [
    ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
    ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
    ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) privateAddresses.addSubnet(network, prefix);
for (const [network, prefix] of [['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20]] as const) {
    privateAddresses.addSubnet(network, prefix, 'ipv6');
}
const globalIPv6 = new BlockList();
globalIPv6.addSubnet('2000::', 3, 'ipv6');

export function isPublicAddress(address: string) {
    const family = isIP(address);
    if (family === 4) return !privateAddresses.check(address);
    return family === 6 && globalIPv6.check(address, 'ipv6') && !privateAddresses.check(address, 'ipv6');
}

export function publicImageUrl(value: string) {
    const url = URL.parse(value);
    if (!url || url.protocol !== 'https:' || url.port || url.username || url.password) return null;
    const address = url.hostname.replace(/^\[|\]$/g, '');
    return isIP(address) && !isPublicAddress(address) ? null : url;
}

const formats = {
    'image/jpeg': { extension: 'jpg', matches: (bytes: Buffer) => bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255])) },
    'image/png': { extension: 'png', matches: (bytes: Buffer) => bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) },
    'image/gif': { extension: 'gif', matches: (bytes: Buffer) => /^GIF8[79]a$/.test(bytes.toString('ascii', 0, 6)) },
    'image/webp': { extension: 'webp', matches: (bytes: Buffer) => bytes.toString('ascii', 0, 4) === 'RIFF'
        && bytes.toString('ascii', 8, 12) === 'WEBP' },
};

type DownloadedImage = { bytes: Buffer; mimeType: string; extension: string };

export async function downloadPublicImage(
    value: string, maxBytes: number, signal: AbortSignal, redirects = 0,
): Promise<DownloadedImage | null> {
    const url = publicImageUrl(value);
    if (!url) return null;

    const response = await new Promise<IncomingMessage>((resolve, reject) => {
        get(url, {
            agent: false, signal, headers: { Accept: 'image/jpeg, image/png, image/gif, image/webp' },
            // Resolve inside the socket's lookup, so the connection uses a validated address.
            lookup(hostname, options, callback) {
                lookup(hostname, { all: true }, (error, addresses) => {
                    if (error) return callback(error, '', 0);
                    const allowed = addresses.filter(record => isPublicAddress(record.address));
                    const first = allowed[0];
                    if (!first) return callback(new Error('Image host has no public address'), '', 0);
                    if (options.all) return callback(null, allowed);
                    return callback(null, first.address, first.family);
                });
            },
        }, resolve).once('error', reject);
    }).catch(() => null);
    if (!response) return null;
    if ([301, 302, 303, 307, 308].includes(response.statusCode ?? 0)) {
        const destination = response.headers.location && URL.parse(response.headers.location, url);
        response.destroy();
        return destination && redirects < 3 ? downloadPublicImage(destination.href, maxBytes, signal, redirects + 1) : null;
    }
    const mimeType = response.headers['content-type']?.split(';')[0]?.trim().toLowerCase() ?? '';
    if (response.statusCode !== 200 || Number(response.headers['content-length']) > maxBytes
        || !Object.hasOwn(formats, mimeType)) {
        response.destroy();
        return null;
    }

    const chunks: Buffer[] = [];
    let size = 0;
    try {
        for await (const chunk of response as AsyncIterable<Buffer>) {
            size += chunk.length;
            if (size > maxBytes) return null;
            chunks.push(chunk);
        }
    } catch {
        return null;
    }
    const bytes = Buffer.concat(chunks, size);
    const format = formats[mimeType as keyof typeof formats];
    return format.matches(bytes) ? { bytes, mimeType, extension: format.extension } : null;
}
