/**
 * Chunker Utilities — File Splitting & Reassembly
 *
 * Handles splitting a File into ArrayBuffer chunks for WebRTC transfer,
 * and reassembly on the receiver side.
 *
 * For files > OPFS_THRESHOLD, uses the Origin Private File System (OPFS)
 * to write chunks directly to disk instead of holding them in RAM.
 */

export const CHUNK_SIZE = 16384; // 16 KB — safe for all browsers via WebRTC DataChannel
export const OPFS_THRESHOLD = 50 * 1024 * 1024; // 50 MB — use OPFS above this

// ─── Sender Side ──────────────────────────────────────────────────────────────

/**
 * Read a single chunk from a File as ArrayBuffer.
 * @param {File} file
 * @param {number} chunkIndex
 * @param {number} [chunkSize]
 * @returns {Promise<ArrayBuffer>}
 */
export function readChunk(file, chunkIndex, chunkSize = CHUNK_SIZE) {
  const start = chunkIndex * chunkSize;
  const end = Math.min(start + chunkSize, file.size);
  const blob = file.slice(start, end);
  return blob.arrayBuffer();
}

/**
 * Calculate total number of chunks for a file.
 * @param {number} fileSize
 * @param {number} [chunkSize]
 * @returns {number}
 */
export function getTotalChunks(fileSize, chunkSize = CHUNK_SIZE) {
  return Math.ceil(fileSize / chunkSize);
}

/**
 * Format bytes into a human-readable string.
 * @param {number} bytes
 * @returns {string}
 */
export function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

/**
 * Format transfer speed.
 * @param {number} bytesPerSecond
 * @returns {string}
 */
export function formatSpeed(bytesPerSecond) {
  return `${formatBytes(bytesPerSecond)}/s`;
}

/**
 * Format remaining time.
 * @param {number} seconds
 * @returns {string}
 */
export function formatETA(seconds) {
  if (!isFinite(seconds) || seconds < 0) return '—';
  if (seconds < 60) return `${Math.ceil(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.ceil(seconds % 60);
  return `${m}m ${s}s`;
}

// ─── Receiver Side (RAM) ──────────────────────────────────────────────────────

/**
 * RAM-based chunk store for files ≤ OPFS_THRESHOLD.
 */
export class RamChunkStore {
  constructor(totalChunks) {
    this.totalChunks = totalChunks;
    this.chunks = new Array(totalChunks).fill(null);
    this.receivedCount = 0;
  }

  /** Store a decrypted chunk at the correct index. */
  addChunk(index, data) {
    if (this.chunks[index] === null) {
      this.chunks[index] = data;
      this.receivedCount++;
    }
  }

  get isComplete() {
    return this.receivedCount === this.totalChunks;
  }

  get progress() {
    return this.receivedCount / this.totalChunks;
  }

  /** Reassemble all chunks into a single ArrayBuffer. */
  assemble() {
    const totalSize = this.chunks.reduce((acc, c) => acc + c.byteLength, 0);
    const result = new Uint8Array(totalSize);
    let offset = 0;
    for (const chunk of this.chunks) {
      result.set(new Uint8Array(chunk), offset);
      offset += chunk.byteLength;
    }
    return result.buffer;
  }

  /** Return the last received chunk index (for resume). */
  get lastReceivedIndex() {
    for (let i = this.totalChunks - 1; i >= 0; i--) {
      if (this.chunks[i] !== null) return i;
    }
    return -1;
  }
}

// ─── Receiver Side (OPFS) ─────────────────────────────────────────────────────

/**
 * OPFS-based chunk store for files > OPFS_THRESHOLD.
 * Writes chunks directly to the Origin Private File System to avoid RAM limits.
 */
export class OpfsChunkStore {
  constructor(totalChunks, fileName) {
    this.totalChunks = totalChunks;
    this.fileName = `p2p-webshare-${Date.now()}-${fileName}`;
    this.receivedCount = 0;
    this.lastIndex = -1;
    this._fileHandle = null;
    this._writable = null;
    this._chunkOffsets = new Array(totalChunks).fill(null);
  }

  /** Initialize OPFS file handle. Must be called before addChunk. */
  async init() {
    const root = await navigator.storage.getDirectory();
    this._fileHandle = await root.getFileHandle(this.fileName, { create: true });
    this._writable = await this._fileHandle.createWritable();
  }

  /** Write a decrypted chunk to OPFS at the correct byte offset. */
  async addChunk(index, data) {
    if (this._chunkOffsets[index] !== null) return; // already received
    const offset = index * CHUNK_SIZE;
    await this._writable.write({ type: 'write', position: offset, data });
    this._chunkOffsets[index] = offset;
    this.receivedCount++;
    this.lastIndex = Math.max(this.lastIndex, index);
  }

  get isComplete() {
    return this.receivedCount === this.totalChunks;
  }

  get progress() {
    return this.receivedCount / this.totalChunks;
  }

  get lastReceivedIndex() {
    return this.lastIndex;
  }

  /**
   * Finalize the OPFS file and return a File object for download/hashing.
   * @param {string} mimeType
   * @returns {Promise<File>}
   */
  async finalize(mimeType) {
    await this._writable.close();
    const file = await this._fileHandle.getFile();
    return new File([file], this.fileName, { type: mimeType });
  }

  /** Clean up the OPFS temp file after download. */
  async cleanup() {
    try {
      const root = await navigator.storage.getDirectory();
      await root.removeEntry(this.fileName);
    } catch {
      // ignore cleanup errors
    }
  }
}

/**
 * Check if OPFS is supported in this browser.
 * @returns {boolean}
 */
export function isOpfsSupported() {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.storage !== 'undefined' &&
    typeof navigator.storage.getDirectory === 'function'
  );
}

/**
 * Create the appropriate chunk store based on file size.
 * @param {number} fileSize
 * @param {number} totalChunks
 * @param {string} fileName
 * @returns {RamChunkStore | OpfsChunkStore}
 */
export function createChunkStore(fileSize, totalChunks, fileName) {
  if (fileSize > OPFS_THRESHOLD && isOpfsSupported()) {
    return new OpfsChunkStore(totalChunks, fileName);
  }
  return new RamChunkStore(totalChunks);
}
