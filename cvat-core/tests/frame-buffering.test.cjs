// Copyright (C) CVAT.ai Corporation
//
// SPDX-License-Identifier: MIT

const assert = require('node:assert/strict');
const { existsSync, readFileSync } = require('node:fs');
const { createRequire } = require('node:module');
const path = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');
const { transformSync } = require('@babel/core');

// Run the production frame/cache code with deterministic worker messages and a
// local metadata endpoint. No browser, server, or real task data is required.
function createSession({
    chunkSize = 1, size = 12, getChunk = async () => new ArrayBuffer(0),
    getPreviewChunk = async () => new ArrayBuffer(1), mode = 'annotation',
    getImageFrame = async (number) => ({ number }),
    width = 32, height = 24,
    frameBufferMultiplier = 10,
} = {}) {
    class Bitmap {
        closed = false;
        close() { this.closed = true; }
    }
    class Worker {
        postMessage({ start, end, block }) {
            queueMicrotask(() => {
                for (let index = start; index <= end; index++) {
                    const bitmap = new Bitmap();
                    bitmap.preview = !!block.byteLength;
                    this.onmessage({ data: { index, data: bitmap } });
                }
            });
        }
        terminate() {}
    }
    const modules = new Map();
    const proxy = { frames: { getData: (_, index) => getPreviewChunk(index),
        getFrame: (_, number, signal) => getImageFrame(number, signal), getMeta: async () => ({
        chunk_size: chunkSize,
        deleted_frames: [],
        frames: [{ width, height, name: 'frame.png', related_files: 0 }],
        size,
        start_frame: 0,
        stop_frame: size - 1,
        frame_filter: '',
        chunks_updated_date: '2026-01-01T00:00:00Z',
    }) } };
    function load(filename) {
        if (modules.has(filename)) return modules.get(filename).exports;
        const module = { exports: {} };
        modules.set(filename, module);
        const localRequire = createRequire(filename);
        const source = transformSync(readFileSync(filename, 'utf8'), {
            filename,
            configFile: path.resolve(__dirname, '../babel.config.json'),
            babelrc: false,
        }).code;
        const execute = vm.runInNewContext(`(function(require, module, exports) { ${source}\n})`, {
            ImageBitmap: Bitmap, Worker, Promise, AbortController, setTimeout, clearTimeout,
            URL, window: { addEventListener() {} },
            createImageBitmap: async ({ number }) => Object.assign(new Bitmap(), { number, preview: false }),
            __filename: filename,
        }, { filename });
        execute((name) => {
            if (name === './server-proxy') return { __esModule: true, default: proxy };
            if (name === 'cvat-data') return load(path.resolve(__dirname, '../../cvat-data/src/ts/cvat-data.ts'));
            if (name.startsWith('.') && !path.extname(name)) {
                const target = path.resolve(path.dirname(filename), name);
                return load(existsSync(`${target}.ts`) ? `${target}.ts` : `${target}.js`);
            }
            return localRequire(name);
        }, module, module.exports);
        return module.exports;
    }
    load(path.resolve(__dirname, '../src/config.ts')).default.frameBufferMultiplier = frameBufferMultiplier;
    const frames = load(path.resolve(__dirname, '../src/frames.ts'));
    const data = load(path.resolve(__dirname, '../../cvat-data/src/ts/cvat-data.ts'));
    return {
        ...frames,
        ...data,
        canvas: load(path.resolve(__dirname, '../../cvat-canvas/src/typescript/canvasModel.ts')),
        read: async (number, playing = true, step = 1, onServerRequest, usePreview = false) => {
            const frame = await frames.getFrame(
                1, chunkSize, 'imageset', mode, number, 0, playing, step,
                data.DimensionType.DIMENSION_2D, getChunk,
            );
            return frame.data(onServerRequest, usePreview);
        },
    };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

test('video playback primes the next chunk before displaying the first buffered frame', async () => {
    let finishDownload;
    const session = createSession({ mode: 'interpolation', chunkSize: 3, getChunk: async (chunk) => (
        chunk === 1 ? new Promise((resolve) => { finishDownload = resolve; }) : new ArrayBuffer(0)
    ) });
    try {
        await session.read(0, false);
        let displayed = false;
        const playing = session.read(1).then(() => { displayed = true; });
        await settle();
        assert.equal(displayed, false, 'initial buffering must precede the first playback image');
        finishDownload(new ArrayBuffer(0));
        await playing;
        assert.equal(displayed, true);
        await settle();
        assert.ok(session.getCachedChunks(1).includes(1));
    } finally {
        session.clear(1);
    }
});

test('preview playback buffers before its first image, not while later chunks are arriving', async () => {
    let finishNext;
    let finishLater;
    const session = createSession({ chunkSize: 3, size: 9, getPreviewChunk: async (chunk) => {
        if (chunk === 1) return new Promise((resolve) => { finishNext = resolve; });
        if (chunk === 2) return new Promise((resolve) => { finishLater = resolve; });
        return new ArrayBuffer(1);
    } });
    try {
        await session.read(0, false, 1, undefined, true);
        let displayed = false;
        const playing = session.read(1, true, 1, undefined, true).then(() => { displayed = true; });
        await settle();
        assert.equal(displayed, false, 'buffering belongs before the first playback image');
        finishNext(new ArrayBuffer(1));
        await playing;
        assert.equal(displayed, true, 'a further pending chunk must not hold the ready image');
    } finally {
        session.clear(1);
        finishNext?.(new ArrayBuffer(1));
        finishLater?.(new ArrayBuffer(1));
    }
});

test('playback prefetches after a cold load, including one-frame chunks', async () => {
    const session = createSession({ size: 120 });
    try {
        await session.read(0);
        await settle();
        assert.deepEqual(Array.from(session.getCachedChunks(1)), Array.from({ length: 100 }, (_, i) => i));
        await session.read(0, false);
        let misses = 0;
        await session.read(1, true, 1, () => { misses++; });
        assert.equal(misses, 0, 'the next frame must already be buffered');
        await settle();
        assert.deepEqual(Array.from(session.getCachedChunks(1)), Array.from({ length: 100 }, (_, i) => i + 1),
            'evict the frame behind playback, not an older prefetched future frame');
        await session.read(2, true, 1, () => { misses++; });
        assert.equal(misses, 0, 'do not download the prefetched next frame a second time');
    } finally {
        session.clear(1);
    }
});

test('paused look-ahead fills ahead and respects chunk boundaries, reverse steps, and job end', async () => {
    const session = createSession({ chunkSize: 3, size: 8 });
    try {
        await session.read(0, false);
        await settle();
        assert.deepEqual(Array.from(session.getCachedChunks(1)), [0, 1, 2], 'pause fills available look-ahead');
        await session.read(7);
        await settle();
        assert.deepEqual(Array.from(session.getCachedChunks(1)), [0, 1, 2], 'no chunk beyond the last frame');
        await session.read(7, true, -1);
        await settle();
        assert.deepEqual(Array.from(session.getCachedChunks(1)), [0, 1, 2]);
        assert.ok((await session.read(4)).imageData);
    } finally {
        session.clear(1);
    }
});

test('a failed speculative download does not interrupt playback and can be retried', async () => {
    let fail = true;
    const session = createSession({ getChunk: async (chunk) => {
        if (chunk === 1 && fail) throw new Error('temporary network failure');
        return new ArrayBuffer(0);
    } });
    try {
        assert.ok((await session.read(0)).imageData);
        await settle();
        assert.deepEqual(Array.from(session.getCachedChunks(1)), [0]);
        fail = false;
        await session.read(0);
        await settle();
        assert.deepEqual(Array.from(session.getCachedChunks(1)), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    } finally {
        session.clear(1);
    }
});

test('a speculative download completing after job close does not affect a reopened job', async () => {
    let finishDownload;
    let delay = true;
    const session = createSession({ getChunk: async (chunk) => {
        if (chunk === 1 && delay) {
            return new Promise((resolve) => { finishDownload = resolve; });
        }
        return new ArrayBuffer(0);
    } });
    try {
        await session.read(0);
        session.clear(1);
        delay = false;
        await session.read(5, false);
        finishDownload(new ArrayBuffer(0));
        await settle();
        assert.deepEqual(Array.from(session.getCachedChunks(1)), [5, 6, 7, 8, 9, 10, 11]);
        assert.ok((await session.read(5, false)).imageData);
    } finally {
        session.clear(1);
    }
});

test('full-quality startup displays one image, then buffers twenty 4K chunks within the decoded budget', async () => {
    let finishCurrent;
    const requested = [];
    const session = createSession({
        width: 3840, height: 2160, chunkSize: 32, size: 768,
        getChunk: async (index) => {
            requested.push(index);
            return index === 0 ? new Promise((resolve) => { finishCurrent = resolve; }) : new ArrayBuffer(0);
        },
    });
    try {
        const first = await session.read(0, false, 1, undefined, 'buffered');
        assert.equal(first.imageData.preview, false);
        assert.equal(first.renderWidth, 3840);
        assert.equal(first.renderHeight, 2160);
        await settle();
        assert.deepEqual(requested, [0], 'the first image does not wait for the whole chunk');
        finishCurrent(new ArrayBuffer(0));
        await settle();
        const buffered = Array.from({ length: 20 }, (_, i) => i);
        assert.deepEqual(Array.from(session.getCachedChunks(1)), buffered, 'buffer ahead while paused');
        assert.deepEqual(requested, buffered, 'do not exceed the twenty-chunk decoded budget');
        let misses = 0;
        const next = await session.read(32, true, 1, () => { misses++; });
        assert.equal(misses, 0);
        assert.equal(next.imageData.preview, false);
        await settle();
        assert.deepEqual(Array.from(session.getCachedChunks(1)), buffered.map((i) => i + 1));
        assert.equal(next.imageData.closed, false, 'keep the displayed chunk alive');
    } finally {
        session.clear(1);
        finishCurrent?.(new ArrayBuffer(0));
    }
});

test('client buffer multiplier scales both the decoded pixel budget and the chunk cap', async () => {
    for (const multiplier of [1, 3, 10]) {
        for (const largeImages of [false, true]) {
            const session = createSession({
                frameBufferMultiplier: multiplier,
                size: 4000,
                chunkSize: largeImages ? 32 : 1,
                width: largeImages ? 3840 : 32,
                height: largeImages ? 2160 : 24,
            });
            try {
                await session.read(0, false);
                await settle();
                // 32 RGBA 4K frames cost 1,061,683,200 bytes per chunk:
                // 2/6/20 GiB hold 2/6/20 chunks. Tiny images hit the chunk cap instead.
                const expected = (largeImages ? 2 : 10) * multiplier;
                assert.deepEqual(Array.from(session.getCachedChunks(1)),
                    Array.from({ length: expected }, (_, i) => i));
                const next = await session.read(largeImages ? 32 : 1);
                assert.equal(next.imageData.preview, false, 'buffer size never changes task quality');
            } finally {
                session.clear(1);
            }
        }
    }
});

test('pause during an in-flight look-ahead continues filling, and a seek redirects the chain', async () => {
    let finishNext;
    const requested = [];
    const session = createSession({ size: 300, getChunk: async (index) => {
        requested.push(index);
        return index === 1 ? new Promise((resolve) => { finishNext = resolve; }) : new ArrayBuffer(0);
    } });
    try {
        await session.read(0);
        await session.read(0, false);
        finishNext(new ArrayBuffer(0));
        await settle();
        assert.deepEqual(Array.from(session.getCachedChunks(1)), Array.from({ length: 100 }, (_, i) => i));
        await session.read(200, false);
        await settle();
        assert.deepEqual(Array.from(session.getCachedChunks(1)), Array.from({ length: 100 }, (_, i) => i + 200));
        assert.ok(!requested.includes(100), 'do not continue filling from the old position');
    } finally {
        session.clear(1);
        finishNext?.(new ArrayBuffer(0));
    }
});

test('decoding ahead evicts the least recently used chunk, not the current frame', async () => {
    const { FrameDecoder, BlockType, DimensionType } = createSession();
    const decoder = new FrameDecoder(BlockType.ARCHIVE, 2, (frame) => frame, DimensionType.DIMENSION_2D);
    const decode = (chunk) => new Promise((resolve, reject) => {
        decoder.requestDecodeBlock(new ArrayBuffer(0), chunk, [chunk], () => {}, resolve, reject);
    });
    try {
        await decode(0);
        await decode(1);
        const current = decoder.frame(0);
        await decode(2);
        assert.equal(current.closed, false, 'prefetch must not close the image being displayed');
        assert.equal(decoder.frame(0), current);
        assert.deepEqual(Array.from(decoder.cachedChunks()), [0, 2]);
        decoder.cleanup(1, [2]);
        await decode(1);
        assert.deepEqual(Array.from(decoder.cachedChunks()), [1, 2],
            'protect the future frame even when a frame behind playback was accessed more recently');
        assert.equal(current.closed, true, 'release the discarded bitmap');
    } finally {
        decoder.close();
    }
});

test('optional previews preserve logical dimensions and do not replace annotation-quality data', async () => {
    const session = createSession();
    try {
        const preview = await session.read(2, true, 1, undefined, true);
        assert.equal(preview.imageData.preview, true);
        assert.equal(preview.renderWidth, 32);
        assert.equal(preview.renderHeight, 24);
        assert.equal((await session.read(2, false, 1, undefined, true)).imageData.preview, true,
            'paused UI can explicitly request a preview before refinement');
        const full = await session.read(2, false);
        assert.equal(full.imageData.preview, false, 'refinement keeps the existing quality');
        assert.equal((await session.read(3)).imageData.preview, false, 'API consumers default to full quality');
    } finally {
        session.clear(1);
    }
});

test('paused refinement can display one full-quality frame without downloading its whole chunk',
    { timeout: 2000 }, async () => {
        const session = createSession({ chunkSize: 8, getChunk: () => new Promise(() => {}) });
        try {
            const full = await session.read(7, false, 1, undefined, 'frame');
            assert.equal(full.imageData.preview, false);
            assert.equal(full.imageData.number, 7);
            assert.equal(full.renderWidth, 32);
            assert.equal(full.renderHeight, 24);
            assert.equal((await session.read(7, false, 1, undefined, true)).imageData.preview, true);
        } finally {
            session.clear(1);
        }
    });

test('individual-frame refinement falls back to existing chunks when unavailable', async () => {
    const session = createSession({ getImageFrame: async () => {
        throw Object.assign(new Error('Unsupported frame endpoint'), { code: 400 });
    } });
    try {
        const full = await session.read(5, false, 1, undefined, 'frame');
        assert.equal(full.imageData.preview, false);
        assert.equal(full.renderWidth, 32);
        assert.equal(full.renderHeight, 24);
    } finally {
        session.clear(1);
    }
});

test('cancelling optional refinement does not download a chunk and a later pause can refine again',
    { timeout: 2000 }, async () => {
        let finish;
        const session = createSession({ getImageFrame: (_, signal) => new Promise((resolve, reject) => {
            finish = resolve;
            signal.addEventListener('abort', () => reject(new Error('Cancelled')), { once: true });
        }) });
        try {
            const frame = await session.getFrame(
                1, 1, 'imageset', 'annotation', 5, 0, false, 1, session.DimensionType.DIMENSION_2D,
                async () => { throw new Error('Cancelled refinement must not download a chunk'); },
            );
            const cancelled = assert.rejects(frame.data(undefined, 'frame'), (error) => error === 5);
            await settle();
            frame.cancelRefinement();
            await cancelled;
            const retried = frame.data(undefined, 'frame');
            await settle();
            finish({ number: 5 });
            assert.equal((await retried).imageData.number, 5);
        } finally {
            session.clear(1);
        }
    });

test('an older server falls back once, then keeps working with existing chunks', async () => {
    let attempts = 0;
    const session = createSession({ getPreviewChunk: async () => {
        attempts++;
        throw Object.assign(new Error('Unsupported data type'), { code: 400 });
    } });
    try {
        assert.equal((await session.read(0, true, 1, undefined, true)).imageData.preview, false);
        assert.equal((await session.read(1, true, 1, undefined, true)).imageData.preview, false);
        assert.equal(attempts, 1);
    } finally {
        session.clear(1);
    }
});

test('canvas readiness waits for the requested image and stale previews cannot replace refinement', async () => {
    const { canvas: { CanvasModelImpl, UpdateReasons } } = createSession();
    const model = new CanvasModelImpl();
    const notifications = [];
    model.subscribe({ notify: (_, reason) => notifications.push(reason) });
    const image = (name) => ({ renderWidth: 32, renderHeight: 24, imageData: { name } });
    const frame = (number, data) => ({ number, width: 32, height: 24, deleted: false, data });
    model.setup(frame(0, async () => image('initial')), []);
    await settle();
    notifications.length = 0;
    let finishPreview;
    const next = frame(1, () => new Promise((resolve) => { finishPreview = resolve; }));
    model.setup(next, []);
    model.setup(next, []);
    model.fitCanvas(1280, 720);
    assert.ok(!notifications.includes(UpdateReasons.OBJECTS_UPDATED),
        'resizing or annotation updates must not mark a frame ready before its image arrives');
    finishPreview(image('preview'));
    await settle();
    assert.equal(model.image.imageData.name, 'preview');
    assert.ok(notifications.includes(UpdateReasons.OBJECTS_UPDATED));

    model.configure({ forceFrameUpdate: true });
    model.setup(frame(1, () => new Promise((resolve) => { finishPreview = resolve; })), []);
    model.setup(frame(1, async () => image('full')), []);
    await settle();
    finishPreview(image('late preview'));
    await settle();
    assert.equal(model.image.imageData.name, 'full', 'a late same-frame preview cannot overwrite full quality');
});
