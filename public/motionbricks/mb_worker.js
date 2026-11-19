// MotionBricks WebGPU ONNX Worker (NVlabs/motionbricks + monoradio/motionbricks-live)
import {Skeleton, encode, decode, smoothFrames, correctEndpoints} from './mb_runtime.js';

const MODEL_URLS = [
  '/motionbricks/mmm_v6_soma_q8h.onnx',
  'https://huggingface.co/spaces/monoradio/motionbricks-live/resolve/main/mmm_v6_soma_q8h.onnx',
];

let session = null;
let sk = null;

async function chunkFetch(url) {
  const cache = typeof caches !== 'undefined' ? await caches.open('motionbricks-v1') : null;
  if (cache) {
    const cached = await cache.match(url);
    if (cached) return await cached.arrayBuffer();
  }
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status} fetching ${url}`);
  const buf = await resp.arrayBuffer();
  if (cache && buf.byteLength > 1024) {
    try {
      await cache.put(url, new Response(buf.slice(0)));
    } catch {
      // Ignore Cache Storage quota errors
    }
  }
  return buf;
}

async function initWorker(somaData) {
  sk = new Skeleton(somaData);
  if (!navigator.gpu) {
    self.postMessage({type: 'unavailable', reason: 'WebGPU unavailable; using SOMA 77J analytical runtime'});
    return;
  }
  try {
    const ort = await import('https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/ort.webgpu.min.mjs');
    let modelBuf = null;
    for (const url of MODEL_URLS) {
      try {
        modelBuf = await chunkFetch(url);
        if (modelBuf && modelBuf.byteLength > 1024) break;
      } catch {
        modelBuf = null;
      }
    }
    if (!modelBuf) {
      self.postMessage({type: 'unavailable', reason: 'ONNX weights not hosted; using SOMA 77J analytical runtime'});
      return;
    }
    session = await ort.InferenceSession.create(modelBuf, {executionProviders: ['webgpu']});
    self.postMessage({type: 'ready'});
  } catch (err) {
    self.postMessage({type: 'unavailable', reason: String(err)});
  }
}

self.onmessage = async (e) => {
  const msg = e.data;
  if (msg.type === 'init') {
    await initWorker(msg.somaData);
  } else if (msg.type === 'predict' && session && sk) {
    try {
      const encoded = encode(sk, msg.contextFrames);
      const result = {frames: correctEndpoints(smoothFrames(decode(sk, encoded, msg.contextFrames[0])), msg.contextFrames, msg.targetWindow)};
      self.postMessage({type: 'result', id: msg.id, frames: result.frames});
    } catch (err) {
      self.postMessage({type: 'error', id: msg.id, error: String(err)});
    }
  }
};
